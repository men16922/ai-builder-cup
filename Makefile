.DEFAULT_GOAL := check
ifneq ($(wildcard .tools/node/bin/node),)
export PATH := $(CURDIR)/.tools/node/bin:$(PATH)
endif
.PHONY: check build test check-android-core
check:
	npm run check
build:
	npm run build
test:
	npm run test:server
check-android-core:
	npm run typecheck
	npm run check:fixtures
	npm run test:android-core

.PHONY: check-agents
# The Python agent crew uses its own virtual environment (.tools/venv-agents); this target never installs anything.
check-agents:
	cd agents && ../.tools/venv-agents/bin/python -m pytest -q
