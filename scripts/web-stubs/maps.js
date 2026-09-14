const React = require('react'); const { View } = require('react-native');
const Box = (p) => React.createElement(View, { style: [{ backgroundColor: '#E9E4F5' }, p.style] }, p.children);
module.exports = Box; module.exports.default = Box; module.exports.Marker = (p) => React.createElement(View, null, p.children); module.exports.PROVIDER_GOOGLE = 'google';
