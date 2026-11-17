import config, { reactConfig } from '@iobroker/eslint-config';

export default [
    ...config,
    ...reactConfig,
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['*.mjs', 'tasks.ts', 'vite.config.ts', 'test/*.js'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        ignores: [
            // unchanged upstream sources and their bundles
            'src-www/**/*',
            'www/**/*',
            'admin/**/*',
            'node_modules/**/*',
            'test/**/*',
            'scripts/**/*',
            'build/**/*',
            'tmp/**/*',
            '.**/*',
        ],
    },
    {
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            '@typescript-eslint/no-require-imports': 'off',
            // JSX transform of React 17+ (tsconfig "jsx": "react-jsx"): no React import needed
            'react/react-in-jsx-scope': 'off',
            'react/jsx-uses-react': 'off',
        },
    },
];
