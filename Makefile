
PYTHON = python3
MANIFEST_INFO = $(PYTHON) ./tools/manifest_info.py
EXTENSION_src = $(shell $(MANIFEST_INFO) src manifest.json)
EXTENSION_src += lrlib/pages/lrp_mentions_view.js
EXTENSION_src += mwel/common/mwel_clipboard.js mwel/pages/mwel_dom.js
EXTENSION_src += orco_pages/orcop_options.js orco_pages/orcop_popup.js
EXTENSION_src += orco_pages/orco_mentions.css
EXTENSION_src += orco_pages/orcop_options.css orco_pages/orcop_popup.css

EXTENSION_name = orco

dist:
	set -e ; \
	version="`python3 -c 'import json, sys; print(json.load(sys.stdin)["version"])' <manifest.json`" ; \
	file="$(EXTENSION_name)-$${version}-unsigned.xpi" ; \
	$(RM) "$$file" ; \
	zip --must-match "$$file" $(EXTENSION_src) ; \
	echo "Created $$file"

.PHONY: dist
