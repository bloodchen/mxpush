import crypto from 'crypto';
import { nanoid } from 'nanoid'
import dotenv from "dotenv";

import { config } from './config.js'
import uWs from "uWebSockets.js"

const tokenPass = "2rnma5xsctJhx1Z$#%^09FYkRfuAsxTB"
const HEARTBEAT_MS = 30000; // 30s 应用层心跳
const HEARTBEAT_TOL = 2;    // 允许丢 2 次

function setAlive(socket) {
    // socket.isAlive = true
    // const now = Math.floor(Date.now() / 1000)
    // socket.pingCheck = now + 20
}
console.log('./uws_' + process.platform + '_' + process.arch + '_' + process.versions.modules + '.node')
// const socketMap = new Map();
// function findSocket(uid) {
//     return socketMap.get(uid)
// }
const socketsByUid = new Map(); // Map<string, Set<ws>>
function findSockets(uid) {
    return socketsByUid.get(uid) || new Set();
}
function addSocket(uid, ws) {
    let set = socketsByUid.get(uid);
    if (!set) { set = new Set(); socketsByUid.set(uid, set); }
    set.add(ws);
}
function removeSocket(uid, ws) {
    const set = socketsByUid.get(uid);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) socketsByUid.delete(uid);
}
function totalConnections() {
    let n = 0; for (const s of socketsByUid.values()) n += s.size; return n;
}
function authenticateFromUrl(u, def) {
    const url = new URL(u, def);
    const params = url.searchParams;
    const auth = params.get('auth') || 'mx';
    const token = params.get('token');
    const uid = params.get('uid');

    if (!uid || !token) return null;        // 先判空！

    const { user_id } = userFromToken({ token });
    if (!user_id) return null;

    if (auth === 'mx') {
        const mxid = uid.split('_')[0];
        if (mxid != user_id) return null;
    }
    return uid;
}

let listenSocket = null;

export async function createServer() {
    const app = uWs.App({})

    app.ws('/*', {
        compression: uWs.DISABLED,//uWs.SHARED_COMPRESSOR,
        maxPayloadLength: 64 * 1024,
        sendPingsAutomatically: true,
        idleTimeout: 120,
        // 4) 背压：一定要加，防止慢连接拖死事件循环
        maxBackpressure: 256 * 1024,            // 256KB 背压上限
        closeOnBackpressureLimit: true,         // 超限直接断，保护整体延迟

        upgrade: (res, req, context) => {
            const host = req.getHeader('host');
            const path = req.getUrl();
            const query = req.getQuery();
            //console.log('[UPGRADE]', { host, path, query });
            const fullUrl = `http://${host}${path}${query ? '?' + query : ''}`;  // ✅
            const uid = authenticateFromUrl(fullUrl);
            const sid = nanoid()
            if (!uid) {
                console.error('rejected one client:', fullUrl);
                res.writeStatus('401 Unauthorized').end('Unauthorized');
                return;
            }
            if (uid) {
                res.upgrade(
                    { uid, sid, pending: new Map() },
                    req.getHeader('sec-websocket-key'),
                    req.getHeader('sec-websocket-protocol'),
                    req.getHeader('sec-websocket-extensions'),
                    context
                );
            }
        },

        open: (ws) => {
            ws.subscribe('hb');          // 订阅心跳频道
            ws._last = Date.now();
            const ud = ws.getUserData();
            addSocket(ud.uid, ws);
            console.log(`Client connected: uid=${ud.uid} sid=${ud.sid} total=${totalConnections()}`);
            ws.send('{"t":"ping"}');
        },

        message: (ws, message, isBinary) => {
            const ud = ws.getUserData();
            const text = Buffer.from(new Uint8Array(message)).toString();
            if (!isBinary) {
                if (text === '{"t":"pong"}') {
                    ws._last = Date.now();   // 记录应用层心跳
                    return;
                }
            }
            // 你的业务日志
            console.log(`Received message from ${ud.uid}: ${text}`);

            // 匹配 _rr 回包
            try {
                const data = JSON.parse(text);
                if (data && data._rr && data._id) {
                    const entry = ud.pending.get(data._id);
                    if (entry) {
                        clearTimeout(entry.timer);
                        ud.pending.delete(data._id);
                        entry.resolve({ code: 0, ...data });
                    }
                }
            } catch { }
        },

        close: (ws, code, message) => {
            const ud = ws.getUserData();
            // 清理挂起请求
            for (const [, entry] of ud.pending) { clearTimeout(entry.timer); entry.resolve({ code: 100, msg: 'closed' }); }
            ud.pending.clear();

            removeSocket(ud.uid, ws);
            console.log(`Client disconnected: uid=${ud.uid} code=${code} total=${totalConnections()}`);
        }
    })

    app.get('/mxpush/url', async (res, req) => {
        res.end(JSON.stringify({ url: 'this' }))
    })
    app.get('/', (res, req) => {
        let url = req.getUrl();
        const ip = getClientIp(req, res)
        console.log(ip)
        res.end(ip)
    })
    app.get('/count', (res, req) => {
        res.end(JSON.stringify({ total: totalConnections(), uids: socketsByUid.size }));
    })
    app.get('/test', async (res, req) => {
        const url = "https://push.mxfast.com/?uid=55505353_3bb7c8ca69a7ebc83db662dba0c97e4f75940000&token=NVQ6wXHqwMUdJM1mIbt4U1gdPyZKujk3t9%252FAxluCYpIs3qqbYrLIx4ECWp%252BhI%252FEl"
        const result = authenticateFromUrl(url)
        res.end(JSON.stringify({ result }))
    })
    app.get('/mxpush/info/', (res, req) => {
        const qs = new URLSearchParams(req.getQuery());
        const mxid = qs.get('uid'); // 这里指前缀 mxid
        const arr = [];
        if (mxid) {
            for (const [uid, set] of socketsByUid.entries()) {
                if (uid.split('_')[0] === mxid) {
                    for (const ws of set) {
                        const ud = ws.getUserData();
                        arr.push({ sid: ud.sid, uid: ud.uid });
                    }
                }
            }
        }
        res.end(JSON.stringify({ count: arr.length, arr }));
    })

    app.post('/mxpush/isonline', async (res) => {
        try {
            const { uids } = await getBody(res);
            const ids = String(uids || '').split(',').filter(Boolean);
            const result = ids.filter((id) => findSockets(id).size > 0);
            res.end(JSON.stringify({ code: 0, result }));
        } catch {
            res.writeStatus('400 Bad Request').end('bad json');
        }
    });
    // 1) HTTP 读 body：getBody()
    async function getBody(res) {
        return new Promise((resolve, reject) => {
            let buffer;
            res.onData((ab, isLast) => {
                // 一定要拷贝！不要用 Buffer.from(ab)
                const chunk = Buffer.from(new Uint8Array(ab));

                buffer = buffer ? Buffer.concat([buffer, chunk]) : chunk;

                if (isLast) {
                    try {
                        resolve(JSON.parse(buffer.toString('utf8')));
                    } catch (e) {
                        // JSON 解析失败就结束请求
                        res.writeStatus('400 Bad Request').end('bad json');
                    }
                }
            });
            res.onAborted(() => reject(new Error('aborted')));
        });
    }
    app.post('/mxpush/post', async (res) => {
        try {
            const { items, key } = await getBody(res);
            if (!config.apiKeys.includes(key)) {
                res.end(JSON.stringify({ code: 101, msg: 'invalid call' }));
                return;
            }

            let delivered = 0;
            const ret = {};

            for (const item of items || []) {
                const { uid, _r, data } = item || {};
                if (!uid) { continue; }

                const uidList = String(uid).split(',').filter(Boolean);
                for (const id of uidList) {
                    const set = findSockets(id);
                    if (set.size === 0) { ret[id] = { code: 101, msg: 'socket not found' }; continue; }

                    if (_r) {
                        // 取第一条连接做 request-reply
                        const ws = set.values().next().value;
                        const reply = await getReply(ws, data);
                        ret[id] = reply;
                        if (reply.code === 0) delivered++;
                    } else {
                        const payload = JSON.stringify({ ...item, uid: undefined });
                        let any = false;
                        for (const ws of set) {
                            if (ws.send(payload)) any = true;  // send=false 表示背压，跳过
                        }
                        ret[id] = any ? { code: 0, msg: 'data sent' } : { code: 102, msg: 'backpressure' };
                        if (any) delivered++;
                    }
                }
            }

            res.end(JSON.stringify({ code: 0, delivered, ret }));
        } catch (e) {
            console.error('/mxpush/post error', e?.message);
            res.writeStatus('400 Bad Request').end('bad json');
        }
    });
    return { app };
}

// 如果直接运行此文件，启动服务器
const { app } = await createServer();
const port = 8080;
app.listen(port, (token) => {
    if (token) {
        listenSocket = token;
        console.log("Starting mxpush service on:", port)
    }
    else
        console.log('Failed to listen to port ' + port);
});
// 1) 全局心跳广播（应用层）
setInterval(() => {
    // 通过 publish 扇出，底层效率更高
    // 如果你担心与业务混淆，可以发更短： 'p'
    // 客户端收到后回 '{"t":"pong"}'
    // 也可以选择让客户端主动发 pong，这里只发 ping
    console.log("sending ping")
    app.publish('hb', '{"t":"ping"}');
}, HEARTBEAT_MS);

// 2) 全局清道夫：扫描并踢出超时连接
const TIMEOUT_MS = HEARTBEAT_MS * (HEARTBEAT_TOL + 1); // Define TIMEOUT_MS based on heartbeat settings
/**
 * 关闭超时的 socket 连接
 * 遍历所有已连接的 ws，如果超时则关闭
 */
function closeTimeoutSockets() {
    const now = Date.now();
    for (const set of socketsByUid.values()) {
        for (const ws of set) {
            if (now - (ws._last || 0) > TIMEOUT_MS) {
                try { ws.end(4000, 'heartbeat timeout'); } catch { }
            }
        }
    }
}
function decrypt({ data, password, from_encoding = 'hex', to_encoding = 'utf8', length = 256 }) {
    try {
        const buf = Buffer.from(data, from_encoding)
        var iv = buf.subarray(0, 16)
        var algorithm = `aes-${length}-cbc`;
        var decipher = crypto.createDecipheriv(algorithm, Buffer.from(password), iv)
        var decrypted = Buffer.concat([decipher.update(buf.subarray(16)), decipher.final()]);
        return decrypted.toString(to_encoding);
    } catch (e) {
        return null
    } //NVQ6wXHqwMUdJM1mIbt4U1gdPyZKujk3t9%2FAxluCYpIs3qqbYrLIx4ECWp%2BhI%2FEl
    //NVQ6wXHqwMUdJM1mIbt4U1gdPyZKujk3t9%2FAxluCYpIs3qqbYrLIx4ECWp%2BhI%2FEl
    //Ce78jYANZG29RbuEH0GZu8PE+OTHTqUlHdu8hrfoMyTkd87tnfN77Y743oZBLQ4z

}
function userFromToken({ token }) {
    try {
        let data = null
        if (token.slice(0, 2) === '2-') { //v2 token
            data = decrypt({ data: token.slice(2), password: tokenPass, from_encoding: "hex" })
        } else
            data = decrypt({ data: token, password: tokenPass, from_encoding: "base64" })
        const user = JSON.parse(data)
        return user || {}
    } catch (e) {
        console.error(e.message)
    }
    return {}
}
dotenv.config()
function getClientIp(req, res) {
    const ip = req.getHeader('cf-connecting-ip') || req.getHeader('x-forwarded-for') || req.getHeader('x-real-ip') || res.getRemoteAddressAsText();
    if (Buffer.isBuffer(ip)) {
        return ip.toString();
    }
    return ip;
}

async function getReply(ws, data, timeout = 50000) {
    return new Promise(resolve => {
        const ud = ws.getUserData();
        const _id = nanoid();
        const payload = JSON.stringify({ _r: true, _id, ...data });

        const ok = ws.send(payload);
        if (!ok) return resolve({ code: 102, msg: 'backpressure' });

        const timer = setTimeout(() => {
            ud.pending.delete(_id);
            resolve({ code: 100, msg: 'timeout' });
        }, timeout);

        ud.pending.set(_id, { resolve, timer });
    })
}
function gracefulShutdown() {
    if (listenSocket) {
        uWs.us_listen_socket_close(listenSocket); // 停止接入新连接
        listenSocket = null;
    }
    // 分批通知和关闭现有连接（避免同一时间全部重连）
    setTimeout(() => process.exit(0), 30_000);
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);