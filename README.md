# sharedb-checklist

Real-time checklist with single adder and multiple checkers.

In future, it will support:

 - finer access control, allowing separated permissions for read, mark, add and delete operations;
 - generate or don't generate random UIDs depending on server configuration;
 - multiple checklist;
 - better backend and embedding capabilities;
 - improved everything.

## How to use

The `allowed.json` file contains a configuration that determine what users are allowed to join.

Currently, even if the syntax allows to define more, there are 2 levels of access:
 - complete access (admin)
 - marker access (regular users)

Give to admins the "rmad" permissions, while to users the "m" one.

You can enable or disable anonymous users.
In general, a user is considered anonymous whenever UID is not provided or when UID is not
in the `allowed.json` list.
To enable anons, create an entry with `"uid": null`.

When using anon, there are two behaviors possible:

 - there is one anon user
 - every access is an anon user

In the first case, you should `allowEmpty`, meaning that if no UID is given, that is treated
as anonymous. Any user connecting to the server and not providing an UID will be treated as
that anon.

In the second case, you should set `"allowEmpty": false`. In this case, users will have to
provide a UID. The client is currently generating random UIDs whenever one is not provided.

This means that if you go to `/`, a cookie is set and a random UID is saved to it. That is
provided to the server, which will authorize you as anon and give you access to the list
(if anon was enabled, ofc). Other users will have a different UID, therefore they will not
access your list: you will be different users.

If you instead force a uid, e.g. going on `/?uid=anon`, then all users accessing through
that path will have access to the same list. No cookie is created in this case.

## Build and deploy

First, build the container for the sharedb server:

    $ podman build -t shared-checklist .

Create a pod for this application, exposing port 8080

    $ podman pod create -n checklist -p 8080

Run mongo container inside the pod, saving the data outside
the container and having a minimum security

    $ mkdir mongo-data
    $ podman run -d --pod checklist \
                 --name mongo \
                 -v "$PWD/mongo-data:/data/db:Z" \
                 -e MONGO_INITDB_ROOT_USERNAME=root \
                 -e MONGO_INITDB_ROOT_PASSWORD=pa55word \
                 -e MONGO_INITDB_DATABASE=leest \
                 -v "$PWD/entrypoint-initdb/:/docker-entrypoint-initdb.d/:Z" \
                 mongo

Run the checklist server

    $ podman run -d --pod checklist \
                 --name shared-checklist \
                 shared-checklist

## Using

Open a fresh browser window (e.g. private mode) and point it to `http://localhost`.
If the anon was enabled in `allowed.json`, the user should be able to see an empty
checklist, otherwise it will be denied.
If denied, you can use `http://localhost/?uid=johndoe` as an example user.

Open a new fresh browser window (e.g. another private mode) and point it to 
`http://localhost:8080/?uid=root`, this will open the (empty) checklist
page and provide a field to enter the entries.

The root user can now add entries, and other window should update in real-time.

If one user checks an entry, the other user should not be able to edit it, but should
see the entry checked immediately.

In general, you might want to create a bunch of random UIDs and give them to
your friends. Each friend should use his UID to access.

Otherwise, enable anon and disable allowEmpty, so that each user will receive a new
UID every time their browser points to the root page (`http://localhost/`). This has
the advantage of being open, but requires each user to be consistent and use the
same browser, as cookies are saved.
