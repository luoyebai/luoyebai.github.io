#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

/* Teaching subset: plain arguments, cd, exit, foreground exec.
 * No quoting, expansion, pipelines, redirection, background or job control. */
int main(void) {
    char *line = NULL;
    size_t capacity = 0;
    int result = 0;
    for (;;) {
        if (isatty(STDIN_FILENO)) { fputs("mini$ ", stdout); fflush(stdout); }
        errno = 0;
        ssize_t length = getline(&line, &capacity, stdin);
        if (length < 0) {
            if (errno == EINTR) { clearerr(stdin); continue; }
            if (ferror(stdin)) { perror("getline"); result = 1; }
            break;
        }
        if (memchr(line, '\0', (size_t)length) != NULL) {
            fputs("NUL bytes are not supported\n", stderr); continue;
        }
        if (strpbrk(line, "\"'\\|&;<>$`(){}*?[]#~") != NULL) {
            fputs("This lesson shell only supports plain arguments\n", stderr); continue;
        }
        char *args[65];
        size_t count = 0;
        char *save = NULL;
        char *word = strtok_r(line, " \t\r\n", &save);
        while (word && count < 64) {
            args[count++] = word;
            word = strtok_r(NULL, " \t\r\n", &save);
        }
        if (word) { fputs("Too many arguments (maximum 64)\n", stderr); continue; }
        if (!count) continue;
        args[count] = NULL;
        if (strcmp(args[0], "exit") == 0) {
            if (count != 1) { fputs("usage: exit\n", stderr); continue; }
            break;
        }
        if (strcmp(args[0], "cd") == 0) {
            if (count != 2) fputs("usage: cd DIRECTORY\n", stderr);
            else if (chdir(args[1]) < 0) perror("cd");
            continue;
        }
        pid_t child = fork();
        if (child < 0) { perror("fork"); continue; }
        if (child == 0) { execvp(args[0], args); perror(args[0]); _exit(127); }
        int status = 0;
        pid_t waited;
        do { waited = waitpid(child, &status, 0); } while (waited < 0 && errno == EINTR);
        if (waited < 0) perror("waitpid");
        else if (WIFSIGNALED(status)) fprintf(stderr, "child stopped by signal %d\n", WTERMSIG(status));
        else if (WIFEXITED(status) && WEXITSTATUS(status) != 0)
            fprintf(stderr, "child exit status: %d\n", WEXITSTATUS(status));
    }
    free(line);
    return result;
}
