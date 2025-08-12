// 测试 setImmediate 如何工作的
setImmediate(() => {
  console.log('setImmediate')
});
setTimeout(() => {
  console.log('setTimeout')
}, 0);

Promise.resolve().then(() => {
  console.log('Promise.resolve')
});
process.nextTick(() => {
  console.log('nextTick')
})