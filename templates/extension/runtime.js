// @ts-check
/// <reference path="./vendor/vne-sdk.d.ts" />

/**
 * Runtime entry. Runs in the editor's preview AND in exported games.
 * Register everything the game needs to play here.
 *
 * Ids you register are namespaced automatically:
 *   "hello" → "com.yourname.my-module/hello"
 *
 * @param {import('./vendor/vne-sdk').RuntimeApi} api
 */
export function activate(api) {
  api.blocks.register({
    id: 'hello',
    category: 'looks',
    shape: 'statement',
    label: 'my.hello',            // i18n key from locales/*.json ("Say hello to {name}")
    args: [{ id: 'name', type: 'string', default: 'world' }],
    run(ctx, args) {
      ctx.runtime.toast(api.i18n.t('my.helloToast', { name: args.name }));
    },
  });
}
