import { Request } from "./request.js";

/**
 * ReqMgr class:
 * manage all requests belong to a tunnel object
 */
export class ReqMgr {
    constructor(cap, tunnel) {
        this.cap = cap;
        this.tunnel = tunnel;
        this.reqq = [];
        for (let i = 0; i < this.cap; i++) {
            // NOTE: use 'i' as tag, but it can use any value instead
            let req = new Request(i, tunnel);
            this.reqq.push(req);
        }
    }

    /**
     * Allocate request object at index with tag.
     * only request that is not inused can be allocated.
     * @param {*} idx idx, request object's index
     * @param {*} tag tag, a new tag for the request object
     * @returns request object
     */
    alloc(idx, tag) {
        if (idx >= this.cap || idx < 0) {
            console.log("reqmgr.alloc idx exceed cap, idx:", idx, ", cap:", this.cap);
            return null;
        }

        let req = this.reqq[idx];
        if (req.inUsed) {
            console.log("reqmgr.alloc request is in used, idx:", idx);
            return null;
        }

        req.tag = tag
        req.idx = idx
        req.isUsed = true

        return req;
    }

    /**
     * free a request object.
     * @param {*} idx idx, request object's index
     * @param {*} tag tag, must match the request's tag
     * @returns none
     */
    free(idx, tag) {
        if (idx >= this.cap || idx < 0) {
            console.log("reqmgr.free idx exceed cap, idx:", idx, ", cap:", this.cap);
            return;
        }

        let req = this.reqq[idx];
        if (!req.isUsed) {
            console.log("reqmgr.free request is not in used, idx:", idx);
            return;
        }

        if (req.tag != tag) {
            console.log("reqmgr.free request tag is not match, idx:", idx, ",tag:", tag);
            return;
        }

        // reset tag
        req.tag++
        req.isUsed = false

        // call free() of request object to close socket and release underlying resource
        req.free()
    }

    /**
     * retrieve a request object
     * @param {*} idx the index of the request
     * @param {*} tag the tag of the request
     * @returns request object if match, otherwise null
     */
    get(idx, tag) {
        if (idx >= this.cap || idx < 0) {
            console.log("reqmgr.get idx exceed cap, idx:", idx, ", cap:", this.cap);
            return null;
        }

        let req = this.reqq[idx];
        if (!req.isUsed) {
            console.log("reqmgr.get request is not in used, idx:", idx);
            return null;
        }

        if (req.tag != tag) {
            console.log("reqmgr.get request tag is not match, idx:", idx, ",tag:", tag);
            return null;
        }

        return req;
    }

    /**
     * free all request objects.
     */
    cleanup() {
        for (let i = 0; i < this.cap; i++) {
            let req = this.reqq[i];
            if (req.inUsed) {
                // reset tag
                req.tag++
                req.isUsed = false

                req.free();
            }
        }
    }
}
