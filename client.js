"use strict";

var sharedb = require("sharedb/lib/client");
var Cookies = require("js-cookie");

function generateRandomUID() {
    return new Array(64)
        .fill(0)
        .map(x =>
            String.fromCharCode(
                "A".charCodeAt(0) + Math.floor(Math.random() * 26)
            )
        )
        .join("");
}

function getWebsocketURI() {
    // If there is not URI, build it
    if (!window.location.search) {
        // If there is a cookie with uid, use that
        var search = "";
        if (document.cookie) {
            console.log("Empty location.search, rebuilding search");
            search = "?uid=" + Cookies.get("uid");
        } else {
            console.log("Empty location.search, building new one");
            var uid = generateRandomUID();
            // Store the uid as a cookie
            Cookies.set("uid", uid);
            // Since search is not present, we create a random token to access as anon
            search = "?uid=" + uid;
        }
        console.log("Search is now", window.location.host, search);
        window.location.search = search;
    } else {
        console.log("Here's the search", window.location.search);
    }
    return "wss://" + window.location.host + window.location.search;
}

var authSocket = new WebSocket(getWebsocketURI());

authSocket.onclose = function(ev) {
    console.log(ev);
    if (ev.code == 3000) {
        document.getElementById("messages").innerText = "Permission denied :(";
    } else {
        document.getElementById("messages").innerText = "Connection closed!";
    }
};

authSocket.onmessage = function(ev) {
    var token = ev.data;
    var config = JSON.parse(ev.data);
    console.log("Got config", config);

    // Auth ok: set-up page
    document.getElementById("checklist-form").style.display = "block";

    // Some people are authorized to add things
    if (config.canAdd === true) {
        var input = document.querySelector(
            '#checklist-form>input[type="text"]'
        );
        input.style.display = "block";
        input.addEventListener("keydown", function(event) {
            if (event.key == "Enter") {
                event.preventDefault();
                var label = event.target.value;
                console.log("Adding new checkbox with value " + label);
                console.log(
                    "Data status: " +
                        doc.data.labels.length +
                        ", " +
                        doc.data.calls.length
                );
                doc.submitOp([
                    { p: ["labels", 0], li: label },
                    { p: ["calls", 0], li: false },
                    { p: ["owner", 0], li: "" }
                ]);
                console.log(
                    "Data status: " +
                        doc.data.labels.length +
                        ", " +
                        doc.data.calls.length
                );
                event.target.value = "";
            }
        });
    }
    // Other people are allowed to remove things
    if (config.canDel === true) {
        var e_checks = document.querySelector(".checkboxes");
        e_checks.addEventListener("click", function(event) {
            if (event.target.className.indexOf("delete") >= 0) {
                event.preventDefault();
                // Find position of child
                var child = event.target.parentNode.parentNode;
                var i = 0;
                while ((child = child.previousSibling) != null) i++;
                doc.submitOp([
                    { p: ["labels", i], ld: doc.data.labels[i] },
                    { p: ["calls", i], ld: doc.data.calls[i] },
                    { p: ["owner", i], ld: doc.data.owner[i] }
                ]);
            }
        });
    }

    var enabler = function(owner, j) {
        return function() {
            console.log("Changing checkbox " + j, ": ", this, this.checked);
            // Set my owner if I'm checking, else set it free
            var newOwner = this.checked ? config.token : "";
            doc.submitOp([
                { p: ["calls", j], ld: !this.checked, li: this.checked },
                { p: ["owner", j], ld: owner, li: newOwner }
            ]);
            return false;
        };
    };

    var uri =
        "wss://" +
        window.location.host +
        window.location.search +
        "&token=" +
        config.token;

    console.log("Opening connection to " + uri);
    // Open WebSocket connection to ShareDB server
    var socket = new WebSocket(uri);
    var connection = new sharedb.Connection(socket);

    // Create local doc instance
    var doc = connection.get("collection", "my-checklist");

    // Get initial value of document and subscribe to changes
    doc.subscribe(showNumbers);
    // When document changes (by this client or any other, or the server),
    // update the number on the page
    doc.on("op", showNumbers);

    function showNumbers() {
        console.log(
            "UPDATE! Data status: " + doc.data.labels + ", " + doc.data.calls
        );
        var e_checks = document.querySelector(".checkboxes");
        if (doc.data.labels.length != doc.data.calls.length) {
            console.log(
                "Ignoring update due to missing data! labels-vs-calls: " +
                    doc.data.labels.length +
                    " " +
                    doc.data.calls.length
            );
            return; // Do not process this change, something is being added
        }
        e_checks.innerHTML = "";
        console.log(
            "Processing update, got",
            doc.data.labels.length,
            "elements"
        );
        for (var i = 0; i < doc.data.labels.length; i++) {
            var state = doc.data.calls[i];
            var label = doc.data.labels[i];
            var owner = doc.data.owner[i];
            var e_li = document.createElement("li");
            var e_label = document.createElement("label");
            var e_box = document.createElement("input");
            var e_span = document.createElement("span");
            e_box.setAttribute("name", "item");
            e_box.setAttribute("type", "checkbox");
            e_box.checked = state;
            e_span.innerHTML = label;
            e_label.appendChild(e_box);
            e_label.appendChild(e_span);
            if (config.canDel === true) {
                var e_del = document.createElement("span");
                e_del.innerText = " \u274c";
                e_del.className = "delete";
                e_label.appendChild(e_del);
            }
            e_li.appendChild(e_label);
            e_checks.appendChild(e_li);

            console.log(
                'Got checkbox "' + label + '"' + ' with owner "' + owner + '"'
            );

            if (owner != "" && owner != config.token) {
                e_box.setAttribute("disabled", true);
            } else {
                e_box.addEventListener("change", enabler(owner, i));
            }
        }
    }
};
