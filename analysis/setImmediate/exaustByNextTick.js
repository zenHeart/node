Promise.resolve().then(() => {
  Promise.resolve().then(() => console.log('Promise.resolve 2 '));
  console.log('sync 0')
  Promise.resolve().then(() => console.log('Promise.resolve 3 '));
  Promise.resolve().then(() => console.log('Promise.resolve 4 '));
  Promise.resolve().then(() => console.log('Promise.resolve 5 '));
  console.log('sync 1')
  Promise.resolve().then(() => console.log('Promise.resolve 6 '));
  process.nextTick(() => console.log('nextTick 2'));
  Promise.resolve().then(() => console.log('Promise.resolve 7 '));
  Promise.resolve().then(() => console.log('Promise.resolve 8 '));
  process.nextTick(() => console.log('nextTick 3'));
  Promise.resolve().then(() => console.log('Promise.resolve 9 '));
  console.log('Promise.resolve 1')
});
process.nextTick(() => console.log('nextTick 1'));