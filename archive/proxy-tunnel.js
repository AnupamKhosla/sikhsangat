import ProxyChain from 'proxy-chain';

const server = new ProxyChain.Server({
    port: 8080,
    prepareRequestFunction: ({ request, username, password, hostname, port, isProxySsh, proxyChainId }) => {
        return {
            upstreamProxyUrl: 'socks5://127.0.0.1:9050',
        };
    },
});

server.listen(() => {
    console.log(`Proxy server is listening on port ${server.port}`);
});

server.on('requestFailed', ({ request, error }) => {
    console.error(`Request to ${request.url} failed: ${error.message}`);
});

server.on('connectionClosed', ({ connectionId }) => {
    // console.log(`Connection ${connectionId} closed`);
});
