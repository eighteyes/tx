FROM node:20

ARG TZ
ENV TZ="$TZ"

ARG CLAUDE_CODE_VERSION=latest

# Setup locales first
RUN apt-get update && apt-get install -y locales && \
    locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8

# Install basic development tools and iptables/ipset
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  git \
  procps \
  sudo \
  fzf \
  zsh \
  man-db \
  unzip \
  gnupg2 \
  gh \
  iptables \
  ipset \
  iproute2 \
  dnsutils \
  aggregate \
  jq \
  nano \
  vim \
  fd-find \
  tmux \
  tini \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create fd symlink (Ubuntu packages it as fd-find)
RUN ln -s /usr/bin/fdfind /usr/local/bin/fd

# Create npm global directory and set permissions
RUN mkdir -p /usr/local/share/npm-global && \
  chown -R node:node /usr/local/share/npm-global && \
  chmod -R 755 /usr/local/share/npm-global

ARG USERNAME=node

# Persist bash history.
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  && mkdir /commandhistory \
  && touch /commandhistory/.bash_history \
  && chown -R $USERNAME /commandhistory

# Set `DEVCONTAINER` environment variable to help with orientation
ENV DEVCONTAINER=true

# Create workspace and config directories and set permissions
RUN mkdir -p /workspace /home/node/.claude && \
  chown -R node:node /workspace /home/node/.claude


ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
  wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# Set up non-root user with sudo access
RUN echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Switch to node user for running commands
USER node

WORKDIR /workspace


# Install global packages
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Set the default shell to zsh rather than sh
ENV SHELL=/bin/zsh

# Set the default editor and visual
ENV EDITOR=nano
ENV VISUAL=nano

# Default powerline10k theme
ARG ZSH_IN_DOCKER_VERSION=1.2.0
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
  -p git \
  -p fzf \
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  -x

# Add Claude aliases, npm alias, and ~/scripts to PATH  
RUN echo 'alias c="claude --dangerously-skip-permissions"' >> /home/node/.zshrc && \
    echo 'alias claude="claude --dangerously-skip-permissions"' >> /home/node/.zshrc && \
    echo 'alias nrd="npm run build"' >> /home/node/.zshrc && \
    echo 'export PATH="$PATH:/home/node/scripts"' >> /home/node/.zshrc && \
    echo 'source ~/.zshrc' >> /home/node/.profile

# Install Claude, ast-grep, and ccusage
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} @ast-grep/cli ccusage

# Use tini as init system to handle zombie processes
ENTRYPOINT ["/usr/bin/tini", "--"]

# Keep container running indefinitely
CMD ["sleep", "infinity"]

