# mxpush

realtime push server

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
