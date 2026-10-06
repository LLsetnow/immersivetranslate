#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/*
 * Firefox/Zen starts native messaging hosts as executables.  Keep the
 * protocol and backend implementation in Python, but use a small native
 * launcher so macOS/Zen does not need to execute a Python shebang directly.
 */
static const char *python_bin =
    "/Users/apple/Documents/github/manga-translator-ui/.venv/bin/python";
static const char *host_script =
    "/Users/apple/Documents/github/immersivetranslate/native-host/manga_backend_host.py";

int main(int argc, char **argv) {
  char **child_argv = calloc((size_t)argc + 2, sizeof(*child_argv));
  if (child_argv == NULL) {
    fprintf(stderr, "manga_backend_host launcher: calloc failed: %s\n",
            strerror(errno));
    return 127;
  }

  child_argv[0] = (char *)python_bin;
  child_argv[1] = (char *)host_script;
  for (int i = 1; i < argc; ++i) {
    child_argv[i + 1] = argv[i];
  }

  execv(python_bin, child_argv);
  fprintf(stderr, "manga_backend_host launcher: execv failed: %s\n",
          strerror(errno));
  free(child_argv);
  return 127;
}
