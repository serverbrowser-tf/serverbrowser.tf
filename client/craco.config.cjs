module.exports = {
  devServer: {
    client: {
      overlay: {
        runtimeErrors: function cb(error) {
          if (error.message.includes("ResizeObserver")) {
            return false;
          }
          return true;
        },
      },
    },
  },
};
