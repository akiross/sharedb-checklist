db.createUser({
    user: "banana",
    pwd: "ananas",
    roles: [{ // give read and write access to the test database
	role: "readWrite",
    	db: "leest"
    }]
});
