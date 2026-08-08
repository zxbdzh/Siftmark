export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    console.info('Siftmark installed');
  });
});
