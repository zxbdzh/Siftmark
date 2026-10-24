/** 页面任务持有共享锁，维护任务（更新/同步）取得独占锁后才允许写入。 */
export async function beginBookmarkActivity(): Promise<() => void> {
  return new Promise((resolve, reject) => {
    void navigator.locks.request('siftmark-maintenance', {mode: 'shared', ifAvailable: true}, async lock => {
      if (!lock) {reject(new Error('同步或更新正在执行，请稍后重试'));return;}
      await new Promise<void>(release => resolve(release));
    }).catch(reject);
  });
}
