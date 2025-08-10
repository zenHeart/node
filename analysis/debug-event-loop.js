/**
 * Node.js 事件循环调试验证脚本
 * 用于断点调试验证事件循环执行顺序和流程
 */

// 启用源码映射支持
require('source-map-support/register');

// 调试标志
const DEBUG = true;

function log(message, ...args) {
  if (DEBUG) {
    console.log(`[${new Date().toISOString()}] ${message}`, ...args);
  }
}

function logPhase(phase, description) {
  log(`\n=== ${phase} ===`);
  log(description);
}

// 验证 process.nextTick 执行时机
function testNextTick() {
  logPhase('NextTick Test', '验证 process.nextTick 优先级');
  
  console.log('1. 同步代码开始');
  
  // 设置断点: 验证 nextTick 在同步代码后立即执行
  process.nextTick(() => {
    console.log('4. process.nextTick 回调执行'); // 断点 1
  });
  
  console.log('2. 同步代码继续');
  
  setImmediate(() => {
    console.log('6. setImmediate 回调执行'); // 断点 2
  });
  
  Promise.resolve().then(() => {
    console.log('5. Promise 微任务执行'); // 断点 3
  });
  
  console.log('3. 同步代码结束');
}

// 验证定时器执行顺序
function testTimers() {
  logPhase('Timer Test', '验证定时器执行顺序');
  
  // 设置断点: 验证不同延迟时间的执行顺序
  setTimeout(() => {
    console.log('Timer 0ms 执行'); // 断点 4
  }, 0);
  
  setTimeout(() => {
    console.log('Timer 1ms 执行'); // 断点 5
  }, 1);
  
  setImmediate(() => {
    console.log('setImmediate 执行'); // 断点 6
  });
}

// 验证微任务和宏任务混合执行
function testMixedTasks() {
  logPhase('Mixed Tasks Test', '验证微任务和宏任务混合执行');
  
  console.log('开始混合任务测试');
  
  // 宏任务
  setTimeout(() => {
    console.log('宏任务: setTimeout'); // 断点 7
    
    // 在宏任务中添加微任务
    Promise.resolve().then(() => {
      console.log('微任务: 宏任务中的 Promise'); // 断点 8
    });
    
    process.nextTick(() => {
      console.log('微任务: 宏任务中的 nextTick'); // 断点 9
    });
  }, 0);
  
  // 微任务
  Promise.resolve().then(() => {
    console.log('微任务: Promise'); // 断点 10
    
    // 在微任务中添加更多微任务
    return Promise.resolve();
  }).then(() => {
    console.log('微任务: 链式 Promise'); // 断点 11
  });
  
  // nextTick
  process.nextTick(() => {
    console.log('微任务: nextTick'); // 断点 12
  });
  
  // setImmediate
  setImmediate(() => {
    console.log('宏任务: setImmediate'); // 断点 13
  });
}

// 验证 I/O 操作的执行时机
function testIOOperations() {
  logPhase('I/O Test', '验证 I/O 操作执行时机');
  
  const fs = require('fs');
  const path = require('path');
  
  // 异步文件读取
  fs.readFile(__filename, 'utf8', (err, data) => {
    if (err) {
      console.error('文件读取错误:', err);
      return;
    }
    console.log('I/O 回调: 文件读取完成'); // 断点 14
    
    // 在 I/O 回调中添加其他任务
    process.nextTick(() => {
      console.log('I/O 回调中的 nextTick'); // 断点 15
    });
    
    setImmediate(() => {
      console.log('I/O 回调中的 setImmediate'); // 断点 16
    });
  });
  
  // 网络请求模拟
  const net = require('net');
  const server = net.createServer();
  
  server.listen(0, () => {
    const port = server.address().port;
    console.log(`服务器启动在端口 ${port}`); // 断点 17
    
    const client = net.createConnection(port, () => {
      console.log('客户端连接成功'); // 断点 18
      client.end();
      server.close();
    });
  });
}

// 验证事件循环阶段
function testEventLoopPhases() {
  logPhase('Event Loop Phases', '验证事件循环各个阶段');
  
  let phaseCounter = 0;
  
  // Timer 阶段
  setTimeout(() => {
    console.log(`阶段 ${++phaseCounter}: Timer 阶段执行`); // 断点 19
  }, 0);
  
  // Poll 阶段 (通过 I/O 操作触发)
  process.nextTick(() => {
    require('fs').stat(__filename, (err, stats) => {
      console.log(`阶段 ${++phaseCounter}: Poll 阶段执行 (I/O 回调)`); // 断点 20
    });
  });
  
  // Check 阶段
  setImmediate(() => {
    console.log(`阶段 ${++phaseCounter}: Check 阶段执行`); // 断点 21
  });
  
  // Close 阶段
  const net = require('net');
  const socket = new net.Socket();
  socket.on('close', () => {
    console.log(`阶段 ${++phaseCounter}: Close 阶段执行`); // 断点 22
  });
  
  // 触发 close 事件
  process.nextTick(() => {
    socket.destroy();
  });
}

// 内存和性能监控
function monitorPerformance() {
  logPhase('Performance Monitor', '监控事件循环性能');
  
  const startTime = process.hrtime.bigint();
  const startMemory = process.memoryUsage();
  
  // 事件循环延迟测试
  setImmediate(() => {
    const endTime = process.hrtime.bigint();
    const endMemory = process.memoryUsage();
    
    console.log('性能指标:'); // 断点 23
    console.log(`- 执行时间: ${Number(endTime - startTime) / 1000000}ms`);
    console.log(`- 内存变化: ${(endMemory.heapUsed - startMemory.heapUsed) / 1024}KB`);
    console.log(`- 事件循环延迟: ${process.hrtime.bigint() - endTime}ns`);
  });
}

// 主测试函数
function runEventLoopDebugTests() {
  console.log('开始 Node.js 事件循环调试测试');
  console.log('请在标记的断点处设置断点进行调试');
  console.log('========================================\n');
  
  // 按顺序执行测试
  testNextTick();
  
  setTimeout(() => {
    testTimers();
  }, 100);
  
  setTimeout(() => {
    testMixedTasks();
  }, 200);
  
  setTimeout(() => {
    testIOOperations();
  }, 300);
  
  setTimeout(() => {
    testEventLoopPhases();
  }, 400);
  
  setTimeout(() => {
    monitorPerformance();
  }, 500);
  
  // 结束标记
  setTimeout(() => {
    console.log('\n========================================');
    console.log('事件循环调试测试完成');
    process.exit(0);
  }, 1000);
}

// 错误处理
process.on('uncaughtException', (err) => {
  console.error('未捕获的异常:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason);
  console.error('Promise:', promise);
});

// 启动调试测试
if (require.main === module) {
  runEventLoopDebugTests();
}

module.exports = {
  testNextTick,
  testTimers,
  testMixedTasks,
  testIOOperations,
  testEventLoopPhases,
  monitorPerformance
};
