# mxpush

realtime push server

## Quick Start

For client

1. call /mxpush/url to get the usable push server url, if got 'this', just use current server
2. call /mxpush/connect to connect to the server

For Server

1. call /mxpush/post to post data to one or more clients

## API

### /mxpush/url

get url of the push service, 'this' means this server or other url

### /mxpush/status

get status of current server

return
{
count //number of current clients
}

### /mxpush/connect?uid=%id%

**id**: uid of the client

connect to the push server

### /mxpush/post

post data to a client

method: POST
Body

```
{
    items:[
        {
            uid, //uid of the client or 'uid1,uid2,uid3' for sending to more clients
            data
        },
        {
            uid,
            data
        },
    ],
    key // apiKey
}
```
