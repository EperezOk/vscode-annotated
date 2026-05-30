import 'mocha/mocha';

export function run(): Promise<void> {
  return new Promise((resolve, reject) => {
    mocha.setup({ ui: 'tdd', reporter: 'spec' });

    // Register suites AFTER mocha.setup so the tdd globals (suite/test) exist.
    Promise.all([
      import('./extension.test'),
      import('./groupStore.integration.test'),
      import('./navigate.integration.test'),
      import('./updateAnnotation.integration.test'),
      import('./updateGroup.integration.test'),
      import('./updateAnnotationRange.integration.test'),
    ])
      .then(() => {
        try {
          mocha.run((failures) => {
            if (failures > 0) {
              reject(new Error(`${failures} test(s) failed.`));
            } else {
              resolve();
            }
          });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .catch(reject);
  });
}
