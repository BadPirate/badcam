.PHONY: check test demo clean

SCRATCH ?= $(CURDIR)/../../../demo-scratch

check:
	python3 -m pytest -q tests
	shellcheck install.sh system/gadget.sh
	python3 -m compileall -q badcam

test:
	python3 -m pytest -q tests

# Builds a fake TeslaCam tree, starts the mock server, runs one detached cycle against it.
demo:
	@set -e; rm -rf "$(SCRATCH)"; mkdir -p "$(SCRATCH)/mount" "$(SCRATCH)/server"; \
	python3 tools/make_fake_teslacam.py "$(SCRATCH)/mount" --events 2 --minutes 2 --junk; \
	python3 tools/mock_server.py --port 8787 --data "$(SCRATCH)/server" --ffprobe > "$(SCRATCH)/server.log" 2>&1 & \
	pid=$$!; trap 'kill $$pid 2>/dev/null' EXIT; sleep 1; \
	sed -e 's#https://badcam.example.com#http://127.0.0.1:8787#' config/badcam.example.toml > "$(SCRATCH)/demo.toml"; \
	python3 -m badcam once --mode detached --config "$(SCRATCH)/demo.toml" --fake-root "$(SCRATCH)/mount"; \
	left=$$(find "$(SCRATCH)/mount/TeslaCam" -type f | wc -l); \
	up=$$(find "$(SCRATCH)/server/files" -type f | wc -l); \
	echo "demo: $$up files on the mock server, $$left files left in the fake tree"; \
	test "$$left" -eq 0 && test "$$up" -gt 0

clean:
	rm -rf .pytest_cache badcam/__pycache__ tests/__pycache__ tools/__pycache__
