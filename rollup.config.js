import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/biometry-sdk.esm.js',
    format: 'esm',
  },
  plugins: [
    typescript(),
    resolve(),
    commonjs(),
  ],
};