'use strict';
const path = require('node:path');
const { tests } = require('@iobroker/testing');

// Only the package files: the adapter has no backend (onlyWWW), so there is no instance to start in an integration test.
tests.packageFiles(path.join(__dirname, '..'));
