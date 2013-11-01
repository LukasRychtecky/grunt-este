/*
 * grunt-este
 * https://github.com/este/grunt-este
 * Copyright (c) 2013 Daniel Steigerwald
 */
module.exports = function (grunt) {

  var fs = require('fs');
  var Mocha = require('mocha');
  var path = require('path');
  var requireUncache = require('require-uncache');
  var Tempfile = require('temporary/lib/file');
  var getDeps = require('../lib/getdeps');
  var originGlobal;

  grunt.registerMultiTask('esteUnitTests', 'Fast unit testing.',
    function() {

      var options = this.options({
        basePath: 'bower_components/closure-library/closure/goog/base.js',
        depsPath: 'client/app/js/deps.js',
        prefix: '../../../../../',
        mockFile: path.join(__dirname, '../', 'lib', 'mocks.js'),

        // Mocha options
        ui: 'tdd',
        reporter: 'dot',
        globals: [],
        timeout: 100

        // bail: true,
        // slow: xy,
        // ignoreLeaks: false,
        // grep: string or regexp to filter tests with
      });
      var key;

      // Clean globals created during tests, goog, este, soy etc...
      // Also fixes goog.base error "Namespace xy already declared.".
      if (originGlobal) {
        for (key in global) {
          if (key in originGlobal) continue;
          delete global[key];
        }
      }

      // store origin global
      if (!originGlobal) {
        originGlobal = {};
        for (key in global)
          originGlobal[key] = true;
      }

      var basePath = options.basePath;
      var testFiles = this.filesSrc;
      var tempNodeBaseFile = new Tempfile();

      // fix for watch mode
      testFiles = testFiles.map(function(file) {
        if (file.indexOf('_test.') == -1)
          file = file.replace('.', '_test.');
        var chunks = file.split('.');
        chunks[chunks.length - 1] = 'js';
        return chunks.join('.');
      });

      if (testFiles.length == 1 && !grunt.file.exists(testFiles[0])) {
        grunt.log.writeln('No tests.');
        return;
      }

      var files = [];
      if (grunt.file.exists(options.depsPath)) {
        var deps = getDeps(options.depsPath, options.prefix);
        var namespaces = getNamespaces(testFiles, deps);
        var depsFiles = getDepsFiles(namespaces, deps);
        var mockFile = options.mockFile;
        var fixedBasePath = fixGoogBaseForNodeAndGetPath(
          basePath,
          tempNodeBaseFile);
        files.push(fixedBasePath, mockFile);
        files.push.apply(files, depsFiles);
      }
      files.push.apply(files, testFiles);

      var absoluteFiles = files.map(function(file) {
        return path.resolve(file);
      });

      var clean = function() {
        tempNodeBaseFile.unlink();
      };

      var done = this.async();

      delete options.basePath;
      delete options.depsPath;
      delete options.prefix;
      delete options.mockFile;
      var mocha = new Mocha(options);

      // Workaround for mocha "0 tests complete" issue.
      // github.com/visionmedia/mocha/issues/445#issuecomment-17693393
      mocha.suite.on('pre-require', function(context, file) {
        requireUncache(file);
      });

      absoluteFiles.forEach(mocha.addFile.bind(mocha));

      // Enforce stack if Mocha crash, for example with "Cannot read property
      // 'required' of undefined" message.
      try {
        mocha.run(function(errCount) {
          clean();
          done(!errCount);
        });
      }
      catch (e) {
        clean();
        grunt.log.error(e.stack);
        done(false);
      }

    }
  );

  /**
    @param {Array.<string>} testFiles
    @param {Object} deps
    @return {Array.<string>}
  */
  var getNamespaces = function(testFiles, deps) {
    var namespaces = [
      // for DOM event simulation
      'goog.testing.events'
    ];
    for (var namespace in deps) {
      var src = deps[namespace].src;
      if (~testFiles.indexOf(src.replace('.js', '_test.js')))
        namespaces.push(namespace);
    }
    return namespaces;
  };

  /**
    @param {Array.<string>} namespaces
    @param {Object} deps
    @return {Array.<string>}
  */
  var getDepsFiles = function(namespaces, deps) {
    var files = [];
    var resolve = function(namespaces) {
      for (var i = 0, length = namespaces.length; i < length; i++) {
        var namespace = namespaces[i];
        if (!deps[namespace])
          continue;
        var src = deps[namespace].src;
        if (~files.indexOf(src))
          continue;
        resolve(deps[namespace].dependencies);
        files.push(src);
      }
    };
    resolve(namespaces);
    return files;
  };

  /**
    @param {string} basePath
    @param {Tempfile} tempNodeBaseFile
    @return {string}
  */
  var fixGoogBaseForNodeAndGetPath = function(basePath, tempNodeBaseFile) {
    var file = fs.readFileSync(basePath, 'utf8');
    // fix Google Closure base.js for NodeJS
    file = file.replace('var goog = goog || {};', 'global.goog = global.goog || {};');
    file = file.replace('goog.global = this;', 'goog.global = global;');
    grunt.file.write(tempNodeBaseFile.path, file, 'utf8');
    return tempNodeBaseFile.path;
  };

};
