/**
 * Webpack configuration for compiling the CKEditor 5 Text Selection plugin.
 *
 * Source lives in src/index.js and is compiled to build/textSelection.js.
 *
 * Build:
 *   npx webpack --mode production
 *
 * Dev build (unminified):
 *   npx webpack --mode development
 */

const path = require('node:path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

const baseConfig = {
  mode: 'production',
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          format: { comments: false },
        },
        test: /\.js(\?.*)?$/i,
        extractComments: false,
      }),
    ],
    moduleIds: 'named',
  },
  entry: {
    path: path.resolve(__dirname, 'src/index.js'),
  },
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'textSelection.js',
    library: ['CKEditor5', 'textSelection'],
    libraryTarget: 'umd',
    libraryExport: 'default',
  },
  plugins: [
    new webpack.BannerPlugin('cspell:disable'),
  ],
  module: {
    rules: [{ test: /\.svg$/, type: 'asset/source' }],
  },
};

const devConfig = {
  ...baseConfig,
  mode: 'development',
  optimization: { ...baseConfig.optimization, minimize: false },
  devtool: false,
};

module.exports = (env, argv) => {
  if (argv.mode === 'development') {
    return devConfig;
  }
  return baseConfig;
};
