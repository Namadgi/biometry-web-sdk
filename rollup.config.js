import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default [
  // 1. SDK core bundle
  {
    input: 'src/sdk/index.ts',
    output: {
      file: 'dist/sdk.js',
      format: 'esm',
      sourcemap: true,
    },
    external: ['react', 'react-dom'],
    plugins: [typescript(), resolve(), commonjs()],
  },

  // 2. UI components
  {
    input: 'src/ui/index.ts',
    output: {
      file: 'dist/ui.js',
      format: 'esm',
      sourcemap: true,
    },
    external: [],
    plugins: [typescript(), resolve(), commonjs()],
  },

  // 3. React wrappers
  {
    input: 'src/ui/react/index.ts',
    output: {
      file: 'dist/react.js',
      format: 'esm',
      sourcemap: true,
    },
    external: ['react', 'react-dom'],
    plugins: [typescript({
      tsconfig: './tsconfig.json',
      declaration: true,
      declarationDir: 'dist',
      rootDir: 'src',
    }), resolve(), commonjs()],
  }
];
