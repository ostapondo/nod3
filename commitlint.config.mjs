export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['server', 'web', 'metrics', 'stt', 'analysis', 'problems', 'runner', 'ci', 'deps', 'docs'],
    ],
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
  },
}
