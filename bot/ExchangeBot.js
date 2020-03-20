var cp = require('child_process');
const {exec} = require('child_process');

const Telegraf = require('telegraf')
const Extra = require('telegraf/extra')
const Markup = require('telegraf/markup')
const session = require('telegraf/session')

const config = require('./config');

const exchangeBot = new Telegraf(config.token)

exchangeBot.catch((err, ctx) => {
    console.error(err);
});

const path = config.path;

const fift = path + 'liteclient-build/crypto/fift -I' + path + 'lite-client/crypto/fift/lib -s';
const fiftInt = path + 'liteclient-build/crypto/fift';
const litenode = cmd => path + 'liteclient-build/lite-client/lite-client -C ' + path + 'liteclient-build/ton-lite-client-test1.config.json -c"' + cmd + '"';


const dex_addr = 'kQAPOWhm7i8cdoUgdxTU3LcT6d0ntchloEAVFUWvFAhNycuL';

const currencies = {
    0: {
        name: 'Gram',
        symbol: '💎',
        decimals: 18,
        isToken: 0,
    }
};

const formatName = (addr) => {
    const currency = currencies[addr];
    if (!currency) {
        return addr;
    }
    return currency.symbol + ' ' + currency.name;
};

const checkAddr = (addr) => new Promise((resolve, reject) => {
    exec([fift, 'check-addr.fif', addr].join(' '), (err, stdout, stderr) => {
        if (err) {
            reject();
        } else {
            const valid = stdout.trimRight().endsWith('-1');
            if (valid) {
                const arr = stdout.split(' ').map(s => s.trim()).filter(s => s.length > 0);
                resolve([valid, arr[2] === '3', arr[0], arr[1]]);
            } else {
                resolve([false, 0, 0, 0]);
            }
        }
    });
});

const sliceToAddr = (slice) => new Promise((resolve, reject) => {
    var child = cp.spawn(fiftInt, ['-i', '-I' + path + 'lite-client/crypto/fift/lib']);

    child.stdin.write('x{' + slice + '} 8 i@+ 256 u@ 0 smca>$ .s');

    child.stdout.on('data', function (data) {
        const arr = format('' + data);
        resolve(arr[0].substring(1, arr[0].length - 1))
    });
    child.stdin.end();
});

const sliceToString = (slice) => new Promise((resolve, reject) => {
    var child = cp.spawn(fiftInt, ['-i', '-I' + path+ 'lite-client/crypto/fift/lib']);

    child.stdin.write('x{' + slice + '} 4 $@ .s');

    child.stdout.on('data', function (data) {
        const arr = format('' + data);
        resolve(arr[0].substring(1, arr[0].length - 1))
    });
    child.stdin.end();
});

const createOrder = (fromValue, fromAddr, toValue, toAddr) => new Promise((resolve, reject) => {
    const fromCurrencyType = currencies[fromAddr].isToken;
    const toCurrencyType = currencies[toAddr].isToken;

    exec([fift, 'insert-order.fif', fromValue, fromCurrencyType, fromAddr, toValue, toCurrencyType, toAddr].join(' '), (err, stdout, stderr) => {
        if (err) {
            reject()
        } else {
            if (stdout.startsWith('x{')) {
                resolve(stdout.substring(2, stdout.length - 2));
            } else {
                reject()
            }
        }
    });
});

const createTokenOrder = (fromValue, fromAddr, toValue, toAddr) => new Promise((resolve, reject) => {
    const fromCurrencyType = currencies[fromAddr].isToken;
    const toCurrencyType = currencies[toAddr].isToken;

    exec([fift, 'transfer-dex.fif', 'dex.addr', fromValue, toValue, toCurrencyType, toAddr].join(' '), (err, stdout, stderr) => {
        if (err) {
            reject()
        } else {
            if (stdout.startsWith('x{')) {
                resolve(stdout.substring(2, stdout.length - 2));
            } else {
                reject()
            }
        }
    });
});

const createApprove = (fromValue) => new Promise((resolve, reject) => {
    exec([fift, 'approve.fif', dex_addr, fromValue].join(' '), (err, stdout, stderr) => {
        if (err) {
            reject()
        } else {
            if (stdout.startsWith('x{')) {
                resolve(stdout.substring(2, stdout.length - 2));
            } else {
                reject()
            }
        }
    });
});

const parseSlice = s => s.substring('CSCell'.length).substring(4);

const format = s => s.trim()
    .replace(/bits.*?}/g, '')
    .replace(/\[/g, '')
    .replace(/]/g, '')
    .replace(/\(/g, '')
    .replace(/\)/g, '')
    .replace(/\{/g, '')
    .replace(/}/g, '')
    .split(' ')
    .filter(s => s.length > 0)
    .map(s => s.startsWith('CSCell') ? parseSlice(s) : s);


const runMethod = (params) => new Promise((resolve, reject) => {
    exec(litenode(params.join(' ')), (err, stdout, stderr) => {
        if (err) {
            reject();
        } else {
            const arr = format(stderr.substring(stderr.indexOf('result:') + 7));
            sliceToString(arr[0]).then(resolve);
        }
    });
});

const getName = (addr) => runMethod(['runmethod', addr, 'get_name']);
const getSymbol = (addr) => runMethod(['runmethod', addr, 'get_symbol']);
const getDecimals = (addr) => runMethod(['runmethod', addr, 'get_decimals']);

async function addCurrency(addr) {
    if (currencies.hasOwnProperty(addr)) {
        return currencies[addr];
    }

    const name = await getName(addr);
    const symbol = await getSymbol(addr);
    const decimals = 10;//await getDecimals(addr);
    currencies[addr] = {
        name: name,
        symbol: symbol,
        decimals: decimals,
        isToken: 1
    }
}

async function getOrderCur(addr) {
    if (addr === '00000000') {
        return 'Gram';
    } else {
        const x = await sliceToAddr(addr);
        return await getName(x);
    }
}

function parseGram(value) {
    return value / 1000000000;
}

function toGram(value) {
    return value * 1000000000;
}

async function parseOrders(arr) {
    if (arr.length === 0) {
        return 'No pending orders';
    } else {
        let result = '';
        const n = Math.floor(arr.length / 7);

        for (let i = 0; i < n * 7; i += 7) {
            const id = Number(arr[i + 0]);
            const paid = Number(arr[i + 1]);
            const sender = await sliceToAddr(arr[i + 2]);
            const fromValue = parseGram(arr[i + 3]);
            const fromCurrency = await getOrderCur(arr[i + 4]);
            const toValue = parseGram(arr[i + 5]);
            const toCurrency = await getOrderCur(arr[i + 6]);
            const orderStr = [id, '-', fromValue, fromCurrency, '->', toValue, toCurrency].join(' ') + '\n';
            result += orderStr;
        }

        return 'Pending orders:\n' + result;
    }
}

const getOrders = (ctx) => new Promise((resolve, reject) => {
    exec(litenode(['runmethod', dex_addr, 'my_orders', ctx.session.myAddrWc, ctx.session.myAddrI].join(' ')), (err, stdout, stderr) => {
        if (err) {
            reject();
        } else {
            parseOrders(format(stderr.substring(stderr.indexOf('result:') + 7))).then(resolve);
        }
    });
});

exchangeBot.use(Telegraf.log())
exchangeBot.use(session())

exchangeBot.command('start', ctx => {
    ctx.session.counter = 0;
    showState(ctx);
});

exchangeBot.hears('💰 New Order', ctx => {
    ctx.session.counter = 1;
    showState(ctx);
});

exchangeBot.hears('👛 My Orders', ctx => {
    ctx.session.counter = 10;
    showState(ctx);
});

const acceptAddress = async (ctx, next) => {
    const text = ctx.message.text;

    const arr = await checkAddr(text);
    if (arr[0]) {
        ctx.session.myAddrWc = arr[2];
        ctx.session.myAddrI = arr[3];
        next();
    } else {
        ctx.reply('Invalid address, try again');
    }
};

const acceptCurrencyType = async (ctx, next) => {
    const text = ctx.message.text;
    switch (text) {
        case '💎 Gram':
            next(false);
            break;
        case '💰 TRC20 Token':
            next(true);
            break;
    }
};

const acceptCurrency = async (ctx, next) => {
    const text = ctx.message.text;

    const arr = await checkAddr(text);
    if (arr[0]) {
        if (arr[1]) {
            ctx.reply('WARNING: Non-bounceable address');
        }

        await addCurrency(text);

        next();
    } else {
        ctx.reply('Invalid address, try again');
    }
};

const acceptAmount = async (ctx, next) => {
    const amount = Number(ctx.message.text);
    if (amount > 0) {
        next();
    } else {
        ctx.reply('Invalid amount, try again:')
    }
};

const showQR = async (ctx, link) => {
    ctx.replyWithPhoto({url: 'https://chart.googleapis.com/chart?chs=360x360&cht=qr&chl=' + link + '&choe=UTF-8'});
};

const showApproveLink = async (ctx) => {
    const gasGram = 1;
    const s = await createApprove(ctx.session.fromAmount);
    const link = 'ton://transfer/' + ctx.session.fromAddr + '?amount=' + toGram(gasGram) + '&text=' + s;

    showQR(ctx, link);

    const message = ctx.session.fromAmount + ' ' + formatName(ctx.session.fromAddr) + ' -> ' + ctx.session.toAmount + ' ' + formatName(ctx.session.toAddr) + '\n\n' +
        'Please approve token transfer to dex:\n\n' +
        link;

    ctx.reply(message, Markup
        .keyboard([
            ['✅ Done!'],
        ])
        .oneTime()
        .resize()
        .extra()
    );
};

const showOrderLink = async (ctx) => {
    let s;
    const fromToken = currencies[ctx.session.fromAddr].isToken;
    if (fromToken) {
        s = await createTokenOrder(ctx.session.fromAmount, ctx.session.fromAddr, ctx.session.toAmount, ctx.session.toAddr);
    } else {
        s = await createOrder(ctx.session.fromAmount, ctx.session.fromAddr, ctx.session.toAmount, ctx.session.toAddr);
    }

    const amount = ctx.session.fromAddr === '0' ? Number(ctx.session.fromAmount) + 1 : 1;

    const link = fromToken ?
        'ton://transfer/' + ctx.session.fromAddr + '?amount=' + toGram(amount) + '&text=' + s
        :
        'ton://transfer/' + dex_addr + '?amount=' + toGram(amount) + '&text=' + s;

    showQR(ctx, link);

    const message = ctx.session.fromAmount + ' ' + formatName(ctx.session.fromAddr) + ' -> ' + ctx.session.toAmount + ' ' + formatName(ctx.session.toAddr) + '\n\n' +
        'To create order please open this link with your TON wallet and send the transaction\n\n' +
        link;

    ctx.reply(message, Markup
        .keyboard([
            ['✅ Done!'],
        ])
        .oneTime()
        .resize()
        .extra()
    );
};

const showState = (ctx) => {
    switch (ctx.session.counter) {
        case 0:
            ctx.reply('Hello!', Markup
                .keyboard([
                    ['💰 New Order', '👛 My Orders'],
                ])
                .oneTime()
                .resize()
                .extra()
            );
            break;

        case 1:
            ctx.reply('Please enter the currency you are giving:', Markup
                .keyboard([
                    ['💎 Gram'],
                    ['💰 TRC20 Token'],
                ])
                .oneTime()
                .resize()
                .extra()
            );
            break;

        case 2:
            ctx.reply('Enter smart-contract address of TRC20 token:');
            break;

        case 3:
            ctx.reply('Please enter the amount of ' + formatName(ctx.session.fromAddr) + ':');
            break;

        case 4:
            ctx.reply('Please enter the currency you receive:', Markup
                .keyboard([
                    ['💎 Gram'],
                    ['💰 TRC20 Token'],
                ])
                .oneTime()
                .resize()
                .extra()
            );

            break;

        case 5:
            ctx.reply('Enter smart-contract address of TRC20 token:');
            break;

        case 6:
            ctx.reply('Please enter the amount of ' + formatName(ctx.session.toAddr) + ':');
            break;

        case 7:
            showApproveLink(ctx);
            break;

        case 8:
            showOrderLink(ctx);
            break;

        case 10:
            ctx.reply('Please enter your wallet address:');
            break;
    }
};

const next = (ctx) => {
    ctx.session.counter++;
    showState(ctx);
};

exchangeBot.on('text', (ctx) => {
    switch (ctx.session.counter) {
        case 1: // enter from currency type
            acceptCurrencyType(ctx, isToken => {
                if (isToken) {
                    next(ctx);
                } else {
                    ctx.session.fromAddr = '0';
                    ctx.session.counter++;
                    next(ctx);
                }
            });
            break;

        case 2: // enter from address
            ctx.session.fromAddr = ctx.message.text;

            acceptCurrency(ctx, () => next(ctx));
            break;

        case 3: // enter from amount
            ctx.session.fromAmount = ctx.message.text;

            acceptAmount(ctx, () => {
                if (ctx.session.fromAddr === '0') {
                    ctx.session.counter++;
                }
                next(ctx)
            });
            break;

        case 4: // enter to currency type
            acceptCurrencyType(ctx, isToken => {
                if (isToken) {
                    next(ctx);
                } else {
                    ctx.session.toAddr = '0';
                    ctx.session.counter++;
                    next(ctx);
                }
            });
            break;

        case 5: // enter from address
            ctx.session.toAddr = ctx.message.text;

            acceptCurrency(ctx, () => next(ctx));
            break;

        case 6: // enter to amount
            ctx.session.toAmount = ctx.message.text;

            acceptAmount(ctx, () => {
                ctx.session.counter++;
                ctx.session.counter++;
                showState(ctx);
            });
            break;

        case 7: // approve sended
            next(ctx);
            break;

        case 8: // create order sended
            ctx.session.counter = 0;
            showState(ctx);
            break;

        case 10: // enter my address
            ctx.session.myAddr = ctx.message.text;

            acceptAddress(ctx, () => {
                ctx.session.counter++;

                getOrders(ctx)
                    .then(s => {
                        ctx.reply(s);
                    })
                    .catch(err => {
                        console.log('system error');
                    });
            });
            break;
    }
});

exchangeBot.launch();
