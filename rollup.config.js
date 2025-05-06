import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default [
  {
    input: 'src/sdk/index.ts',
    output: {
      file: 'dist/sdk.js',
      format: 'esm',
    },
    plugins: [typescript(), resolve(), commonjs()],
  },
  {
    input: 'src/ui/index.ts',
    output: {
      file: 'dist/ui.js',
      format: 'esm',
    },
    plugins: [typescript(), resolve(), commonjs()],
  }
];
