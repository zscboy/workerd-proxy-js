import { ReqMgr } from "./reqmgr.js";
import { Buffer } from 'node:buffer';

const CMD_None = 0;
const CMD_Ping = 1;
const CMD_Pong = 2;
const CMD_ReqBEGIN = 3;
// client and server use this cmd to send request's data
const CMD_ReqData = 3;
// client notify server that a new request has created
const CMD_ReqCreated = 4;
// client notify server that a request has closed
const CMD_ReqClientClosed = 5;
// client notify server that a request has finished, but not closed
const CMD_ReqClientFinished = 6;
// server notify client that a request has finished, but not closed
const CMD_ReqServerFinished = 7;
// server notify client that a request has closed
const CMD_ReqServerClosed = 8;
// server notify client that a request quota has been refresh,
// means that client can send more data of this request
const CMD_ReqRefreshQuota = 9;
const CMD_ReqEND = 10;

/**
 * Tunnel class:
 * Wrapper a websocket connection, and manange requests
 * At client side there is a tunnel object corresponding to this tunnel object.
 */
export class Tunnel {
    /**
     * new a Tunnel object
     * @param {*} mgr tunnel manager
     * @param {*} id tunnel unique id
     * @param {*} reqCap how many requests cant tunnel serve
     * @param {*} websocket tunnel's websocket connection
     */
    constructor(mgr, id, reqCap, websocket) {
        this.mgr = mgr;
        this.id = id;
        this.reqCap = reqCap;
        this.reqMgr = new ReqMgr(reqCap, this);
        this.setupWebsocket(websocket);
        this.lastActivate = Date.now();
        this.inSending = false;
        this.sendBufs = [];
    }

    /**
     * listen to events of the websocket object
     * @param {*} websocket
     */
    setupWebsocket(websocket) {
        this.websocket = websocket;

        websocket.addEventListener('message', event => {
            this.lastActivate = Date.now();
            this.onTunnelMessage(event.data);
        });

        let closeHandler = evt => {
            console.log('closeHandler, id:', this.id);
            this.onClosed();
        };

        let errorHandler = evt => {
            console.log('errorHandler, id:', this.id);
            // 'close' event will emit later
        };

        websocket.addEventListener("close", closeHandler);
        websocket.addEventListener("error", errorHandler);
    }

    /**
     * send ping message to client side
     * if there are too many ping messages without reply,
     * then close the tunnel
     * @param {*} now current time
     * @param {*} throttle tunnel idle time need to send ping message
     * @returns
     */
    keepalive(now, throttle) {
        if (this.waitingPing > 3) {
            this.close();
            return;
        }

        let th = now - this.lastActivate;
        if (th > throttle) {
            this.sendPingMessage();
            this.waitingPing++;
        }
    }

    /**
     * construct and send a ping message
     */
    async sendPingMessage() {
        const arr = new ArrayBuffer(9);
        let buf = Buffer.from(arr);
        let offset = 0;
        // 1 byte cmd
        buf.writeUInt8(CMD_Ping, offset);
        offset += 1;

        // timestamp
        let now = Date.now();
        buf.writeDoubleLE(now, offset);

        await this.send(buf);
    }

    /**
     * construct and reply a pong message
     * @param {*} origin data from client side's ping message
     */
    async sendPongMessage(origin) {
        const arr = new ArrayBuffer(origin.length);
        let buf = Buffer.from(arr);
        origin.copy(buf, 0, 0, origin.length);

        // 1 byte cmd
        buf.writeUInt8(CMD_Pong, 0);
        await this.send(arr);
    }

    /**
     * we got the client side's reply of out ping message,
     * reset the counter
     */
    onPong() {
        this.waitingPing = 0;
    }

    /**
     * when websocket connection is closed
     */
    onClosed() {
        let thisObj = this;
        // resolve all waiting promises
        this.sendBufs.forEach((sendBuf) => {
            thisObj.callSendBufResolve(sendBuf);
        });
        // reset array to empty
        this.sendBufs = [];

        // clear all requests
        this.reqMgr.cleanup();

        // notify tunnel manager we have been closed
        this.mgr.onTunnelClosed(this);
        // close the websocket handle, release its resource underlying
        this.close();
    }

    /**
     * close websocket connection
     * @returns none
     */
    close() {
        if (!this.isWebsocketValid()) {
            return;
        }

        try {
            this.websocket.close();
            this.websocket = null;
        } catch (err) {
            console.log("tunnel onClosed exception:", err);
        }
    }

    isWebsocketValid() {
        return this.websocket !== null && this.websocket !== undefined;
    }

    /**
     * Tunnel send a message, we need to push the message to an array
     * and send one by one
     * @param {*} buf message body
     * @returns promise
     */
    async send(buf) {
        if (!this.isWebsocketValid()) {
            console.log("Tunnel.send, websocket isn't valid, id:", this.id);
            return Promise.resolve();
        }

        if (this.websocket.readyState != WebSocket.READY_STATE_OPEN) {
            console.log("Tunnel.send, websocket state isn't open, id:", this.id);
            return Promise.resolve();
        }

        let thisObj = this;
        let promise = new Promise((resolve, reject) => {
            let sendBuf = {
                "buf": buf,
                "resolve": resolve,
                "reject": reject,
            };
            thisObj.pushSendRequest(sendBuf);
        });

        return promise;
    }

    pushSendRequest(sendBuf) {
        this.sendBufs.push(sendBuf);
        this.startSendLoop();
    }

    startSendLoop() {
        if (this.inSending) {
            return;
        }

        this.sendLoop();
    }

    async sendLoop() {
        this.inSending = true;
        try {
            // loop until all buffers have been sent out
            while (this.sendBufs.length > 0) {
                let sendBufs = this.sendBufs;
                this.sendBufs = [];
                let count = sendBufs.length;
                for (let i = 0; i < count; i++) {
                    let sendBuf = sendBufs[i];
                    await this.websocket.send(sendBuf.buf);
                    this.callSendBufResolve(sendBuf);
                }
            }
        } catch (err) {
            console.log("Tunnel.sendLoop exception:", err);
        } finally {
            this.inSending = false;
        }
    }

    callSendBufResolve(sendBuf) {
        try {
            sendBuf.resolve.resolve();
        } catch (err) {
            console.log("Tunnel.callSendBufResolve, resolve exception:", err);
        }
    }

    onTunnelMessage(data) {
        if (data.length < 1) {
            console.log("Tunnel got 0 length message");
            return;
        }

        let databuf = Buffer.from(data);
        // read header
        let offset = 0;
        let cmd = databuf.readUInt8(offset);
        offset += 1;

        if (this.isRequestCmd(cmd)) {
            this.onRequestMessage(cmd, databuf);
        } else {
            switch (cmd) {
                case CMD_None:
                    console.log("Tunnel.onTunnelMessage CMD_None, tunnel id:", this.id);
                    break;
                case CMD_Ping:
                    this.sendPongMessage(databuf);
                    break;
                case CMD_Pong:
                    this.onPong();
                    break;
                default:
                    console.log("Tunnel.onTunnelMessage unknown cmd:", cmd, ", tunnel id:", this.id);
            }
        }
    }

    onRequestMessage(cmd, databuf) {
        let offset = 1; // skip 'cmd code' byte
        let idx = databuf.readUInt16LE(offset);
        offset += 2;
        let tag = databuf.readUInt16LE(offset);
        offset += 2;

        switch (cmd) {
            case CMD_ReqCreated:
                this.onRequestCreated(idx, tag, databuf, offset);
                break;
            case CMD_ReqData:
                this.onReqClientData(idx, tag, databuf, offset);
                break;
            case CMD_ReqClientFinished:
                this.onReqClientFinished(idx, tag);
                break;
            case CMD_ReqClientClosed:
                this.onReqClientClosed(idx, tag);
                break;
            default:
                console.log("Tunnel.onRequestMessage, unknown cmd :", cmd,
                    ", tunnel id:", this.id, ", idx:", idx, ", tag:", tag);
        }
    }

    onRequestCreated(idx, tag, databuf, offset) {
        let addressType = databuf.readUInt8(offset);
        offset++;

        let port = 0;
        let domain = "";
        switch (addressType) {
            case 0: // ipv4
                domain = message[4] + "." + message[3] + "." + message[2] + "." + message[1];
                port = databuf.readUInt16LE(offset);
                offset += 2;
                break;
            case 1: // domain name
                let domainLen = databuf.readUInt8(offset);
                offset++;
                domain = databuf.slice(offset, offset + domainLen).toString();
                offset += domainLen;
                port = databuf.readUInt16LE(offset);
                offset += 2;
                break;
            case 2: // ipv6
                let p1 = databuf.readUInt16LE(offset);
                offset += 2;
                let p2 = databuf.readUInt16LE(offset);
                offset += 2;
                let p3 = databuf.readUInt16LE(offset);
                offset += 2;
                let p4 = databuf.readUInt16LE(offset);
                offset += 2;
                let p5 = databuf.readUInt16LE(offset);
                offset += 2;
                let p6 = databuf.readUInt16LE(offset);
                offset += 2;
                let p7 = databuf.readUInt16LE(offset);
                offset += 2;
                let p8 = databuf.readUInt16LE(offset);
                offset += 2;

                domain = p8 + ":" + p7 + ":" + p6 + ":" + p5 + ":" + p4 + ":" + p3 + ":" + p2 + ":" + p1;
                port = databuf.readUInt16LE(offset);
                offset += 2;
            default:
                console.log("onRequestCreated, unsupport addressType:", addressType)
                return
        }

        let req = this.reqMgr.alloc(idx, tag)
        if (req == null) {
            console.log("onRequestCreated, alloc req failed:", err)
            return
        }

        let addr = domain + ":" + port;
        req.proxy(addr);
    }

    onReqClientData(idx, tag, databuf, offset) {
        let req = this.reqMgr.get(idx, tag)
        if (req == null) {
            // req has been free
            return
        }

        req.onClientData(databuf, offset)
    }

    onReqClientFinished(idx, tag) {
        let req = this.reqMgr.get(idx, tag)
        if (req == null) {
            // req has been free
            return
        }

        req.onClientFinished()
    }

    onReqClientClosed(idx, tag) {
        this.reqMgr.free(idx, tag);
    }

    isRequestCmd(cmd) {
        if (cmd >= CMD_ReqBEGIN && cmd < CMD_ReqEND) {
            return true;
        }

        return false;
    }

    async onReqServerData(req, data) {
        const arr = new ArrayBuffer(5 + len(data));
        let buf = Buffer.from(arr);

        buf.writeUInt8(CMD_ReqData, 0);
        buf.writeUInt16LE(req.idx, 1);
        buf.writeUInt16LE(req.tag, 3);
        let databuf = Buffer.from(data);
        databuf.copy(buf, 5, 0);

        await this.send(buf);
    }

    async onReqServerClosed(req) {
        // send close event to client
        const arr = new ArrayBuffer(5);
        let buf = Buffer.from(arr);
        buf.writeUInt8(CMD_ReqServerClosed, 0);
        buf.writeUInt16LE(req.idx, 1);
        buf.writeUInt16LE(req.tag, 3);

        await this.send(buf);

        this.reqMgr.free(idx, tag);
    }

    async onReqServerFinished(req) {
        // send finish event to client
        const arr = new ArrayBuffer(5);
        let buf = Buffer.from(arr);
        buf.writeUInt8(CMD_ReqServerFinished, 0);
        buf.writeUInt16LE(req.idx, 1);
        buf.writeUInt16LE(req.tag, 3);

        await this.send(buf);

        this.reqMgr.free(idx, tag);
    }
}
