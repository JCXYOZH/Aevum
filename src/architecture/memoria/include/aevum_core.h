// Aevum Memoria C++ 公共入口。
//
// 构建统一提供：
//   -I<repo>/src/architecture/memoria
//
// 模块内外都写：
//   #include <include/aevum_core.h>
//
// 各模块头文件位于 include/ 下，由本文件集中包含。

#pragma once

#include <include/chain_unit.h>
#include <include/checkpoint.h>
#include <include/config.h>
#include <include/embedding_layer.h>
#include <include/fixed_rms_norm.h>
#include <include/gated_valve.h>
#include <include/generator.h>
#include <include/metrics_calculator.h>
#include <include/model.h>
#include <include/module_io.h>
#include <include/processor.h>
#include <include/strata_memory.h>
#include <include/subnet.h>
#include <include/text_dataset.h>
#include <include/trainer.h>
#include <include/tri_balancer.h>
