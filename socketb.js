import { connect } from 'cloudflare:sockets';

// socket is connecting to target address
const STATE_CONNECTING = 0;
// socket has connected successfully
const STATE_CONNECTTED = 1;
// socket has closed
const STATE_CLOSED = 2;

/**
 * Socketb class:
 * wrap a C++ socket object
 */
export class Socketb {
    /**
     * new a Socketb object
     * @param {*} address target address
     * @param {*} evtCallback events callback function
     */
    constructor(address, evtCallback) {
        // NOTE: we currently not support server side half close
        // If we need that feature, pass { allowHalfOpen: true } to connect method
        let sock = connect(address);
        this.state = STATE_CONNECTING;
        this.evtCallback = evtCallback;
        this.sock = sock;
        this.chunks2Send = [];
        this.inSending = false;
        this.setupSocket(sock);
    }

    isConnected() {
        return this.state == STATE_CONNECTTED;
    }

    isClosed() {
        return this.state == STATE_CLOSED;
    }

    chunkCountWatingSend() {
        return this.chunks2Send.length;
    }

    /**
     * listen to events of C++ socket
     * @param {*} sock C++ socket object
     */
    setupSocket(sock) {
        let thisObj = this;
        sock.opened.then(
            (sockinfo) => {
                console.log("Socketb socket opened, sockinfo:", sockinfo);
                thisObj.onConnected();
            },
            (reason) => {
                console.log("Socketb socket connect failed:", reason);
                thisObj.onError();
            },
        );

        sock.closed.then(
            () => {
                console.log("Socketb socket closed");
                thisObj.onClosed();
            },
            (err) => {
                console.log("Socketb socket closed error:", err);
                thisObj.onClosed();
            },
        );
    }

    onConnected() {
        this.state = STATE_CONNECTTED;
        this.evtCallback(this, { event: "connected" });
        this.startReadLoop();
        this.startSendLoop();
    }

    onError() {
        this.evtCallback(this, { event: "error" });
        this.sock = null;
        this.chunks2Send = [];
        this.state = STATE_CLOSED;
    }

    onClosed() {
        this.state = STATE_CLOSED;
        this.sock = null;
        this.chunks2Send = [];
        this.evtCallback(this, { event: "closed" });
    }

    startReadLoop() {
        this.readLoop();
    }

    async readLoop() {
        try {
            for await (const chunk of this.sock.readable) {
                await this.evtCallback(this, { event: "data", data: chunk });
            }

            if (this.isConnected()) {
                this.evtCallback(this, { event: "finish" });
            }
        } catch (err) {
            console.log("Socketb readLoop exception:" + err);
        }
    }

    write(chunk) {
        if (this.isClosed()) {
            return;
        }

        // save to buffers array, waiting for writable stream ready to send
        this.chunks2Send.push(chunk);

        if (!this.inSending) {
            this.startSendLoop();
        }
    }

    startSendLoop() {
        if (this.inSending) {
            // already in sending state
            return;
        }

        writeLoop();
    }

    async writeLoop() {
        let writer = null;

        try {
            this.inSending = true;
            writer = this.sock.writable.getWriter();

            while (this.chunks2Send.length > 0) {
                let chunks = this.chunks2Send;
                this.chunks2Send = [];

                let count = chunks.length;
                for (let idx = 0; idx < count; idx++) {
                    let chunk = chunks[idx];
                    await writer.write(chunk);
                }
            }
        } catch (err) {
            console.log("Socketb write exception:" + err);
        } finally {
            if (writer != null) {
                writer.releaseLock();
            }

            this.inSending = false;
        }
    }

    shutdownWrite() {
        // TODO: call writable stream's shutdown method
    }

    close() {
        try {
            if (this.sock != null) {
                this.sock.close();
            }
        } catch (err) {
            console.log("Socketb close exception:" + err);
        }
    }
}
