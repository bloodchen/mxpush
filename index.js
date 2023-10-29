import fastifyModule from 'fastify';
import dotenv from "dotenv"
import pkg from "better-sse";

const { createSession } = pkg;

export const app = fastifyModule({ logger: false });

async function startServer() {
    app.register(fastForm)
    const port = process.env.port || 8080
    await app.listen({ port, host: '0.0.0.0' });
    console.log("Starting login service on:", port)
}
dotenv.config()
startServer()
let count = 0
const clients = {}
app.get('/mxpush/get', async (req, res) => {
    console.log("got one connection. total = ", ++count)
    const { uid } = req.query
    if (!uid) return { code: 100, msg: 'uid is missing' }
    const eventName = process.env.eventName || 'mxpush'
    const session = await createSession(req.raw, res.raw, { headers: { "Access-Control-Allow-Origin": '*' } })
    clients[uid] = session
    session.on("disconnected", () => {
        console.log("one user disconnected. total = ", --count)
    })
    session.push('connected', eventName)
})
app.post('/mxpush/post', async (req, res) => {
    const { items } = req.body
    const eventName = process.env.eventName || 'mxpush'
    let delivered = 0
    for (const item of items) {
        const uid = item.uid
        if (!uid) return { code: 100, msg: 'uid is missing' }
        const uids = uid.split(',')
        for (u of uids) {
            const session = clients[u]
            if (session) {
                session.push(item.data, eventName)
                delivered++
            }
        }
    }
    return { code: 0, delivered }
})