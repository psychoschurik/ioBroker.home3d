import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['*.mjs', 'tasks.ts', 'test/*.js'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        ignores: [
            // unchanged upstream sources and their bundles
            'vendor-src/**/*',
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
        },
    },
];
