module.exports = {
    apps: [
        {
            name: "mxpush",
            script: "index.js",
            exec_mode: "cluster",     // 多进程
            instances: "max",         // 或写具体核数，比如 8
            // uWS 多进程同端口 => 依赖 SO_REUSEPORT（uWS 已支持）
            env: {
                NODE_ENV: "production",
                PORT: "8080"
            },
            node_args: [
                "--max-old-space-size=1024" // 视内存调
            ],
            autorestart: true,
            max_memory_restart: "800M", // 单进程内存上限，超了重启
            kill_timeout: 30000,        // 给你的优雅关停 30s 窗口
            listen_timeout: 10000,      // 等待应用就绪（可选）
            // 日志（容器里建议仍用 docker logs；若要文件日志可开启）
            // out_file: "/dev/stdout",
            // error_file: "/dev/stderr",
            // merge_logs: true,
        },
    ],
};