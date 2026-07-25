const path = require('path');
const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'inline-source-map',
  devServer: {
    host: '127.0.0.1',
    port: 8091,
    open: false,
    hot: false,
    liveReload: false,
    client: false,
    webSocketServer: false,
    static: {
      directory: path.resolve(__dirname),
      watch: false,
    },
    devMiddleware: {
      writeToDisk: false,
    },
  },
});
