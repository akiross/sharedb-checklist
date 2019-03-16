var _ = require('underscore');
var fs = require('fs');
var crypto = require('crypto');

var http = require('http');  // Creating http server
var express = require('express');  // Web framework
var WebSocket = require('ws');  // Realtime communication
var WebSocketJSONStream = require('websocket-json-stream');

var ShareDB = require('sharedb');  // The magic is here :)
var ShareDBAccess = require('sharedb-access');
var db = require('sharedb-mongo')('mongodb://localhost:27017/test');


// Users allowed to access the checklist
var allowed = JSON.parse(fs.readFileSync('allowed.json', 'utf8'));
console.log("Allowed users", allowed);
var root = "root";

function makeToken(uid) {
	return crypto.createHash('md5').update(uid).digest('hex');
}

var collectionName = 'collection';
var backend = new ShareDB({db});

backend.use('connect', (request, next) => {
	console.log('Connection');
	if (!_.isUndefined(request.req)) {
		request.agent.connectSession = {'uid': request.req.uid,
			                            'token': request.req.token};
	}
	next();
});

ShareDBAccess(backend);

// Everyone is allowed to read
backend.allowRead(collectionName, async (docId, doc, session) => {
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
backend.allowUpdate(collectionName, async (docId, oldDoc, newDoc, ops, session) => {
	console.log("Update", docId, session);
	if (session.uid == root) {
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
		if (ops[i]['p'][0] != 'owner')
			continue;
		var op = ops[i]['p'];
		var oldOwner = oldDoc.owner[op[1]];
		var newOwner = newDoc.owner[op[1]];
		console.log('    Changing owner from "' + oldOwner + '" to "' + newOwner + '" by user "' + session.uid + '" "' + session.token + '"');
		if (oldOwner != '' && oldOwner != session.token) {
			console.log(' -> Permission denied, old owner is not null and not myself');
			return false; // Cannot change another owner!
		}
	}
	console.log("Update: user", session.uid, "managed to update " + oldDoc + " to " + newDoc);

	return true;
});

// Create initial document then fire callback
function createDoc(callback) {
  var connection = backend.connect();
  var doc = connection.get(collectionName, 'my-checklist');
  doc.fetch(function(err) {
    if (err) throw err;
    if (doc.type === null) {
      doc.create({labels: [], calls: [], owner: []}, callback);
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
	app.use(express.static('static'));
	app.get('/', (req, res) => {
		res.send(`
<!DOCTYPE html>
<html>
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<link rel="stylesheet" href="style.css" />
	</head>
	<body>
		<section>
			<h2>Checklist</h2>
			<p id='messages'></p>
			<form id="checklist-form" style='display: none;'>
				<input type='text' placeholder='Add element' style='display: none;' />
			    <ul class="checkboxes">
				</ul>
			</form>
		</section>
		<script src="dist/bundle.js"></script>
	</body>
</html>`);
	});
	var server = http.createServer(app);

	// Connect any incoming WebSocket connection to ShareDB
	var wss = new WebSocket.Server({server: server});
	wss.on('connection', function(ws, req) {
		console.log('Started connection from ' + req.url);

		// If no parameters were passed, we are sure user cannot access
		var params = req.url.split('?uid=')[1]; 
		if (_.isUndefined(params)) {
			ws.close(3000, 'Not allowed');
			return;
		}

		// Get user ID from query
		var uid = params.split('&')[0];
		var token = params.split('&token=')[1];
		console.log("Got uid " + uid + " and token " + token);
		if (!_.isUndefined(uid) && _.isUndefined(token)) {
			// UID is defined, but no token: establishing connection
			if (!(uid in allowed)) {
				ws.close(3000, 'Not allowed');
				return; // Not allowed
			}
			console.log("Connection from uid " + uid);
			ws.send(JSON.stringify({
				'token': makeToken(uid),  // Send access token to client
				'canAdd': uid === root,  // Only root can add elements
			}));
		} else if (!_.isUndefined(uid) && !_.isUndefined(token)) {
			// We got both UID and token, we can open a connection
			if (makeToken(uid) == token) {
				console.log("Started auth connection with token " + token);
				var stream = new WebSocketJSONStream(ws);
				backend.listen(stream, {'uid': uid, 'token': token});
			} else {
				console.log("Wrong token!");
			}
		}
	});

	var port = 8080;
	server.listen(port);
	console.log("Listening on http://localhost:" + port);
}

createDoc(startServer);

