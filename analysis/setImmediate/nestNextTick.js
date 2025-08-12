
count = 0;
function nestLoop() {
  if (count >= 10) return;
  Promise.resolve().then(() => {
    console.log(`Promise.resolve ${++count}`);
    process.nextTick(() => {
      console.log(`process.nextTick ${++count}`);
      nestLoop();
    });
  });
  // 这里可以添加更多的逻辑来模拟嵌套循环
}
console.log('开始嵌套循环');
nestLoop();
console.log('嵌套循环已启动');