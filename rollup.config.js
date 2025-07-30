import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default [
  // SDK core bundle
  {
    input: 'src/sdk/index.ts',
    output: {
      file: 'dist/sdk.js',
      format: 'esm',
      sourcemap: true,
    },
    external: ['react', 'react-dom'],
    plugins: [typescript(), resolve(), commonjs()],
  }
];
