var _ = require("underscore");
var fs = require("fs");
var crypto = require("crypto");

var http = require("http"); // Creating http server
var express = require("express"); // Web framework
var url = require("url");
var querystring = require("querystring");
var WebSocket = require("ws"); // Realtime communication
var WebSocketJSONStream = require("websocket-json-stream");

var ShareDB = require("sharedb"); // The magic is here :)
var ShareDBAccess = require("sharedb-access");
var db = require("sharedb-mongo")(
    "mongodb://banana:ananas@localhost:27017/leest"
);

// This parse the acess control file and builds easy to use structures
class Auth {
    constructor(path) {
        console.log("Parsing authorization file");
        //th`is.path = path;
        var list = JSON.parse(fs.readFileSync(path, "utf8"));

        // Sets of users that have certain permissions
        this.readers = Object.create(null);
        this.markers = Object.create(null);
        this.adders = Object.create(null);
        this.deleters = Object.create(null);
        this.uids = Object.create(null);

        for (var i in list) {
            console.log("Parsing", list[i]);
            if (!("uid" in list[i])) {
                console.log("Missing UID key, skipping auth entry", i, list[i]);
                continue;
            }
            var uid = list[i]["uid"];
            this.uids[uid] = true; // Store valid UIDs
            // Anon might allow empty uid or not
            if (uid === null) {
                this.allowEmptyUID = list[i]["allowEmpty"] || false;
                console.log(
                    "Allowing empty UIDs for anon:",
                    this.allowEmptyUID
                );
            }

            var access = "m"; // Marker by default
            if ("access" in list[i]) {
                access = list[i]["access"];
            }
            if (access.includes("r")) this.readers[uid] = true;
            if (access.includes("m")) this.markers[uid] = true;
            if (access.includes("a")) this.adders[uid] = true;
            if (access.includes("d")) this.deleters[uid] = true;
        }
    }

    // any UID which was not present in the access file is considered "anon"
    toValidUID(uid) {
        // If uid was in the access file, then is valid
        if (uid in this.uids) return uid;
        // If was not present, then we consider it as "anon"
        // as anonymous users will have randomly assegnated UIDs
        return null;
    }

    canMark(uid) {
        return this.toValidUID(uid) in this.markers;
    }

    // Adders can add without having to see the list (usually not the case, but never say never)
    canAdd(uid) {
        return this.toValidUID(uid) in this.adders;
    }

    canDelete(uid) {
        return this.toValidUID(uid) in this.deleters;
    }

    // Users that can read, mark and delete should be able to see the entire list
    canRead(uid) {
        uid = this.toValidUID(uid);
        return uid in this.readers || this.canMark(uid) || this.canDelete(uid);
    }

    hasFullAccess(uid) {
        uid = this.toValidUID(uid);
        return (
            this.canRead(uid) &&
            this.canMark(uid) &&
            this.canAdd(uid) &&
            this.canDelete(uid)
        );
    }

    makeToken(uid) {
        if (uid === null) return "00000000000000000000000000000000"; // Anon token
        return crypto
            .createHash("md5")
            .update(uid)
            .digest("hex");
    }
}

var auth = new Auth("allowed.json");

var collectionName = "collection";
var backend = new ShareDB({ db });

backend.use("connect", (request, next) => {
    console.log("Connection");
    if (!_.isUndefined(request.req)) {
        request.agent.connectSession = {
            uid: request.req.uid,
            token: request.req.token
        };
    }
    next();
});

ShareDBAccess(backend);

// Everyone is allowed to read
backend.allowRead(collectionName, async (docId, doc, session) => {
    // TODO read access here?
    console.log("Read", docId, session);
    return true;
});

// Everyone is allowed to create the document
backend.allowCreate(collectionName, async (docId, doc, session) => {
    console.log("Create", docId, session);
    return true;
});

// Now check if the user is allowed to update the document.
// Some users can add fields, other users can only change check status
backend.allowUpdate(
    collectionName,
    async (docId, oldDoc, newDoc, ops, session) => {
        console.log("Update", docId, session);
        if (auth.hasFullAccess(session.uid)) {
            console.log("User " + session.uid + " allowed to change anything");
            return true;
        }

        if (oldDoc.labels.length != newDoc.labels.length) {
            console.log("User " + session.uid + " cannot change the labels!");
            return false;
        }

        if (oldDoc.calls.length != newDoc.calls.length) {
            console.log("User " + session.uid + " cannot change the calls!");
            return false;
        }

        if (oldDoc.owner.length != newDoc.owner.length) {
            console.log("User " + session.uid + " cannot change the owner!");
            return false;
        }

        // Check ops if there is a change of owner
        for (var i = 0; i < ops.length; i++) {
            console.log("  Update op", ops[i]);
            if (ops[i]["p"][0] != "owner") continue;
            var op = ops[i]["p"];
            var oldOwner = oldDoc.owner[op[1]];
            var newOwner = newDoc.owner[op[1]];
            console.log(
                '    Changing owner from "' +
                    oldOwner +
                    '" to "' +
                    newOwner +
                    '" by user "' +
                    session.uid +
                    '" "' +
                    session.token +
                    '"'
            );
            if (oldOwner != "" && oldOwner != session.token) {
                console.log(
                    " -> Permission denied, old owner is not null and not myself"
                );
                return false; // Cannot change another owner!
            }
        }
        console.log(
            "Update: user",
            session.uid,
            "managed to update " + oldDoc + " to " + newDoc
        );

        return true;
    }
);

// Create initial document then fire callback
function createDoc(callback) {
    var connection = backend.connect();
    var doc = connection.get(collectionName, "my-checklist");
    doc.fetch(function(err) {
        if (err) throw err;
        if (doc.type === null) {
            doc.create({ labels: [], calls: [], owner: [] }, callback);
            return;
        }
        callback();
    });
}

// Il server deve iniziare la sessione sapendo che UID e token sono correlati
// quando inizia la sessione e riceve entrambi, controlla che sia tutto corretto

function startServer() {
    // Create a web server to serve files and listen to WebSocket connections
    var app = express();
    app.use(express.static("static"));
    var server = http.createServer(app);

    // Connect any incoming WebSocket connection to ShareDB
    var wss = new WebSocket.Server({ server: server });
    wss.on("connection", function(ws, req) {
        var query = querystring.parse(url.parse(req.url).query);
        console.log("Started connection from " + req.url);
        console.log("Got query params", query);

        var uid = query.uid;
        var token = query.token;

        // If no UID is specified, you might want to assume it's anon
        if (_.isUndefined(uid)) {
            if (auth.allowEmptyUID) {
                uid = null; // No token, anon user
            } else {
                // We don't allow empty UIDs
                ws.close(3000, "Not allowed");
                return;
            }
        }

        console.log("Got uid " + uid + " and token " + token);
        if (_.isUndefined(token)) {
            // If token is undefined, connection has to be established
            if (auth.canRead(uid)) {
                console.log("UID can read, connection from uid " + uid);
                ws.send(
                    JSON.stringify({
                        token: auth.makeToken(uid), // Send access token to client
                        canAdd: auth.canAdd(uid),
                        canDel: auth.canDelete(uid)
                    })
                );
            } else {
                // User cannot read, not allowed
                ws.close(3000, "Not allowed");
            }
        } else {
            // We got both UID and token, we can open a connection
            if (auth.makeToken(uid) == token) {
                console.log("Started auth connection with token " + token);
                var stream = new WebSocketJSONStream(ws);
                backend.listen(stream, { uid: uid, token: token });
            } else {
                console.log("Wrong token!"); // FIXME shall we give back some error code here?
            }
        }
    });

    var port = 8080;
    server.listen(port);
    console.log("Listening on http://localhost:" + port);
}

createDoc(startServer);
