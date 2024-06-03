import { Socketb } from "./socketb.js";

/**
 * Request class:
 * hold a tcp/udp socket object, and manage its lifecycle
 */
export class Request {
    constructor(tag, tunnel) {
        this.tag = tag;
        this.tunnel = tunnel;
        this.inUsed = false;

        this.socketb = null;
    }

    free() {
        if (this.socketb != null) {
            this.socketb.close();
            this.socketb = null;
        }
    }

    /**
     * handle data from client side
     * @param {*} databuf data body
     * @param {*} offset offset of the data buffer
     */
    onClientData(databuf, offset) {
        if (this.socketb != null) {
            let end = databuf.length;
            let data = databuf.slice(offset, end);
            this.socketb.write(data);
        }
    }

    /**
     * handle 'finish' event from client side.
     * we need to half close the socket object.
     */
    onClientFinished() {
        if (this.socketb != null) {
            this.socketb.shutdownWrite();
        }
    }

    /**
     * create a socket and connect to addr, start the proxy-progress
     * @param {*} toAddr target address
     * @returns none
     */
    proxy(toAddr) {
        if (this.socketb != null) {
            console.log("Request.proxy failed: request already in proxying");
            return;
        }

        let thisObj = this;

        let socketb = new Socketb(toAddr, async (sock, eventObj) => {
            if (sock !== thisObj.socketb) {
                return;
            }

            switch (eventObj.event) {
                case "data":
                    thisObj.onServerData(eventObj.data);
                    break;
                case "closed":
                    thisObj.onServerClosed();
                    break;
                default:
                    break;
            }
        });

        this.socketb = socketb;
    }

    /**
     * handle our socket's data event.
     * @param {*} data data body
     */
    onServerData(data) {
        this.tunnel.onReqServerData(this, data);
    }

    /**
     * handle our socket's close event.
     */
    onServerClosed() {
        this.tunnel.onReqServerClosed(this);
    }
}
