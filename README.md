# sharedb-checklist

Real-time checklist with single adder and multiple checkers.

## Running

Test setup using open-to-everybode mongo

    mkdir data
	docker run -d -p 27017:27017 -v "$PWD/data/:/data/db" mongo
	npm run build
	npm run start
