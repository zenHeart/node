// setImmediate(() => {
//   console.log('setImmediate'); // 断点 2
// });
// setTimeout(() => {
//   console.log('setTimeout 回调执行 0'); // 断点 3
// }, 0);
Promise.resolve().then(() => {
  debugger;
  console.log('Promise 微任务执行'); // 断点
});
process.nextTick(() => {
  debugger;
  console.log('nextTick 任务执行'); // 断点 1
});
