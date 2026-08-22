NAME    = ximera
SHELL   = bash
INPUTS  = $(wildcard src/*.dtx) $(wildcard src/interactives/*.dtx) $(NAME).dtx
OUTPUTS = ximera.cls xourse.cls ximera.4ht xourse.4ht ximera.cfg
DIST    = dist

# One pdflatex invocation produces .cls/.4ht/.cfg (via docstrip) and
# .pdf (via the standard document body) in a single pass. The pattern
# rule persuades GNU make that all listed outputs come from one recipe.
# See https://stackoverflow.com/questions/2973445 .

all:	$(DIST)/ximera.cls

# Single pdflatex run produces .cls/.4ht/.cfg via docstrip AND ximera.pdf
# via the doc body. We track dist/ximera.cls as the stamp; the recipe
# moves everything into dist/ at the end. ximera.pdf lands alongside the
# .dtx source (gitignored per ximera-core/.gitignore).
$(DIST)/ximera.cls: $(INPUTS)
	pdflatex -shell-escape -recorder -interaction=batchmode $(NAME).dtx >/dev/null
	if [ -f $(NAME).glo ]; then makeindex -q -s gglo.ist -o $(NAME).gls $(NAME).glo; fi
	if [ -f $(NAME).idx ]; then makeindex -q -s gind.ist -o $(NAME).ind $(NAME).idx; fi
	pdflatex --recorder --interaction=nonstopmode $(NAME).dtx > /dev/null
	pdflatex --recorder --interaction=nonstopmode $(NAME).dtx > /dev/null
	mkdir -p $(DIST)
	mv $(OUTPUTS) $(DIST)/

clean:
	rm -f $(NAME).{aux,fls,glo,gls,hd,idx,ilg,ind,ins,log,out}

distclean: clean
	rm -f $(NAME).pdf $(OUTPUTS)
	rm -rf $(DIST)

.PHONY: all clean distclean
