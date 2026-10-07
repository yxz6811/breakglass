// Node consumers share the canonical pure math contract shipped in the extension.
// Browsers load extension/src/plugin/math-learning.js before plugin/contracts.js.
module.exports = require('../extension/src/plugin/math-learning.js');
