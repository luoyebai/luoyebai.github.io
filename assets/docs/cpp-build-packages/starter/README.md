# C++17 build lesson

Requires a C++17 compiler and CMake 3.20 or newer. No external packages.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build --config Debug
ctest --test-dir build -C Debug --output-on-failure
```

With a single-configuration generator run `./build/lesson_demo`.
With Visual Studio run `build\Debug\lesson_demo.exe`. Expected output: `10`.

Tests remain active in Release builds. Temporarily returning `value` from
`clamp_value` should make boundary tests fail; restore the implementation
after the exercise. Generated `build/` files are not project sources.
