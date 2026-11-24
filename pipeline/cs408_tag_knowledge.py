"""First-pass chapter-level knowledge tags for 408 questions."""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANK = ROOT / "pipeline" / "output" / "cs408-bank.jsonl"
OUT = ROOT / "pipeline" / "output" / "cs408-tags.json"

KEYWORDS: dict[str, list[tuple[str, int]]] = {
    "DS1": [("时间复杂度", 4), ("空间复杂度", 4), ("算法", 2), ("数据结构", 3), ("逻辑结构", 3), ("存储结构", 3), ("抽象数据类型", 4)],
    "DS2": [("线性表", 4), ("顺序表", 4), ("单链表", 4), ("双链表", 4), ("循环链表", 4), ("链表", 3), ("头结点", 3), ("前驱", 2), ("后继", 2)],
    "DS3": [("栈", 3), ("队列", 3), ("循环队列", 5), ("入栈", 3), ("出栈", 3), ("数组", 2), ("矩阵", 3), ("压缩存储", 4), ("对称矩阵", 4), ("稀疏矩阵", 4), ("后缀表达式", 6), ("前缀表达式", 6), ("中缀表达式", 6), ("表达式求值", 5)],
    "DS4": [("二叉树", 4), ("树", 1), ("森林", 3), ("哈夫曼", 5), ("并查集", 5), ("堆", 2), ("遍历", 3), ("先序", 3), ("中序", 3), ("后序", 3), ("层序", 3), ("线索", 4), ("叶子", 3), ("高度", 2), ("前缀编码", 6), ("编码方案", 4), ("哈夫曼树", 6)],
    "DS5": [("图", 1), ("顶点", 3), ("边", 1), ("邻接", 4), ("最短路径", 5), ("拓扑排序", 5), ("关键路径", 5), ("最小生成树", 5), ("Dijkstra", 5), ("Prim", 4), ("Kruskal", 4), ("深度优先", 4), ("广度优先", 4), ("AOV", 4), ("AOE", 4)],
    "DS6": [("查找", 3), ("折半查找", 5), ("二叉搜索树", 5), ("二叉排序树", 5), ("平衡二叉树", 5), ("红黑树", 5), ("B树", 4), ("B 树", 5), ("B+树", 4), ("B+ 树", 5), ("散列", 5), ("哈希", 5), ("冲突", 3), ("装填因子", 4), ("KMP", 5), ("模式匹配", 4), ("ASL", 3)],
    "DS7": [("排序", 4), ("插入排序", 5), ("冒泡排序", 5), ("选择排序", 5), ("希尔排序", 5), ("快速排序", 5), ("堆排序", 4), ("归并排序", 4), ("基数排序", 4), ("外部排序", 5), ("稳定性", 4), ("比较次数", 3), ("归并段", 6), ("路归并", 6), ("虚段", 6)],
    "CO1": [("计算机系统", 3), ("冯·诺依曼", 5), ("存储程序", 5), ("层次结构", 2), ("性能指标", 4), ("CPI", 5), ("MIPS", 5), ("主频", 4), ("时钟周期", 3), ("吞吐量", 3), ("响应时间", 3), ("PFLOPS", 6), ("超级计算机", 5), ("TOP500", 5), ("浮点运算速度", 5)],
    "CO2": [("补码", 5), ("原码", 4), ("反码", 4), ("移码", 4), ("浮点数", 5), ("IEEE 754", 6), ("阶码", 4), ("尾数", 4), ("溢出", 3), ("算术移位", 5), ("逻辑移位", 5), ("加法器", 4), ("定点数", 4), ("无符号数", 4), ("有符号数", 4), ("海明码", 6), ("校验位", 5), ("纠错", 4), ("检错", 4), ("类型转换", 5), ("符号扩展", 5), ("unsigned", 3), ("short", 3)],
    "CO3": [("存储器", 3), ("Cache", 6), ("高速缓存", 6), ("主存", 4), ("虚拟存储器", 5), ("页表", 3), ("TLB", 5), ("快表", 5), ("局部性", 4), ("磁盘", 3), ("固态硬盘", 4), ("RAID", 5), ("存储层次", 4), ("命中率", 4), ("替换算法", 4), ("写策略", 4), ("DRAM", 6), ("SRAM", 6), ("刷新", 5), ("存储阵列", 5), ("地址引脚", 5), ("随机存取", 5), ("芯片", 3)],
    "CO4": [("指令格式", 5), ("寻址方式", 5), ("操作数", 3), ("指令字", 4), ("定长指令", 4), ("变长指令", 4), ("CISC", 5), ("RISC", 5), ("机器级", 4), ("汇编", 3), ("编译器", 3), ("链接", 2), ("对齐", 3), ("大端", 4), ("小端", 4), ("机器语言程序", 5), ("汇编语言程序", 5), ("硬件描述语言", 5), ("条件跳转", 5), ("过程调用", 5), ("过程返回", 5), ("陷阱", 4), ("控制转移", 6), ("下一条指令", 4)],
    "CO5": [("CPU", 4), ("中央处理器", 5), ("控制器", 3), ("数据通路", 5), ("指令流水线", 6), ("流水线", 4), ("冒险", 4), ("数据冒险", 5), ("控制冒险", 5), ("结构冒险", 5), ("中断", 2), ("异常", 2), ("多处理器", 4), ("超标量", 4), ("硬件多线程", 4), ("标志寄存器", 6), ("条件转移", 5), ("微程序", 5), ("微指令", 5), ("下地址", 4)],
    "CO6": [("总线", 5), ("系统总线", 5), ("地址总线", 4), ("数据总线", 4), ("控制总线", 4), ("I/O接口", 5), ("I/O方式", 5), ("程序查询", 5), ("程序中断", 4), ("DMA", 5), ("通道", 3), ("设备控制器", 4), ("编址", 3), ("总线事务", 4), ("总线定时", 4)],
    "OS1": [("操作系统", 3), ("内核", 3), ("用户态", 4), ("内核态", 4), ("系统调用", 5), ("中断", 2), ("异常", 2), ("引导", 3), ("虚拟机", 4), ("微内核", 5), ("宏内核", 5), ("外核", 5), ("链接", 2), ("装入", 3), ("多道程序", 6), ("单道程序", 6)],
    "OS2": [("进程", 4), ("线程", 4), ("调度", 3), ("时间片", 4), ("优先级", 3), ("信号量", 6), ("P操作", 5), ("V操作", 5), ("wait", 3), ("signal", 3), ("互斥", 5), ("同步", 4), ("临界区", 5), ("死锁", 6), ("银行家算法", 6), ("资源分配图", 5), ("进程通信", 4), ("管道", 3), ("共享内存", 4), ("上下文切换", 5)],
    "OS3": [("内存管理", 4), ("分页", 5), ("分段", 4), ("段页式", 5), ("虚拟内存", 6), ("页面置换", 6), ("缺页", 5), ("页表", 4), ("页框", 4), ("逻辑地址", 4), ("物理地址", 4), ("地址转换", 4), ("LRU", 5), ("FIFO", 5), ("OPT", 4), ("工作集", 5), ("抖动", 5), ("内存映射", 5), ("动态分区", 6), ("最佳适配", 6), ("首次适配", 6), ("空闲分区", 6), ("内存碎片", 6), ("分区", 3), ("回收", 2)],
    "OS4": [("文件", 3), ("目录", 3), ("索引节点", 5), ("inode", 5), ("文件控制块", 5), ("FCB", 5), ("FAT", 5), ("链接分配", 5), ("索引分配", 5), ("连续分配", 5), ("文件系统", 4), ("硬链接", 4), ("软链接", 4), ("磁盘块", 4), ("簇", 3)],
    "OS5": [("I/O管理", 5), ("设备管理", 4), ("设备驱动程序", 5), ("缓冲区", 3), ("单缓冲", 4), ("双缓冲", 4), ("磁盘调度", 6), ("电梯算法", 5), ("SPOOLing", 5), ("设备分配", 4), ("中断处理", 3), ("磁道", 4), ("SCAN", 5), ("寻道", 4), ("旋转延迟", 4)],
    "CN1": [("计算机网络", 3), ("体系结构", 3), ("OSI", 5), ("TCP/IP", 5), ("分层", 3), ("协议", 2), ("服务", 2), ("带宽", 3), ("时延", 3), ("吞吐量", 3), ("往返时间", 4), ("RTT", 3)],
    "CN2": [("物理层", 5), ("编码", 2), ("调制", 3), ("奈奎斯特", 6), ("香农", 6), ("传输介质", 5), ("双绞线", 4), ("光纤", 4), ("信道", 4), ("波特率", 4), ("比特率", 4), ("10BaseT", 6), ("曼彻斯特", 6), ("波形", 4), ("CDMA", 6), ("码片序列", 6), ("载波", 5), ("调制方法", 5), ("多路复用", 5)],
    "CN3": [("数据链路层", 5), ("帧", 3), ("以太网", 5), ("MAC", 4), ("CSMA/CD", 6), ("CSMA/CA", 6), ("PPP", 5), ("交换机", 5), ("网桥", 4), ("差错控制", 4), ("滑动窗口", 4), ("停止等待", 5), ("后退N帧", 5), ("选择重传", 5), ("VLAN", 5), ("CRC", 6), ("生成多项式", 5), ("介质访问控制", 5), ("冲突", 3)],
    "CN4": [("网络层", 5), ("IP", 2), ("IPv4", 5), ("IPv6", 5), ("路由", 4), ("路由器", 5), ("子网", 5), ("子网掩码", 5), ("CIDR", 5), ("ARP", 5), ("ICMP", 5), ("NAT", 5), ("DHCP", 5), ("分组", 3), ("分片", 4), ("转发", 4), ("路由表", 4), ("组播", 4), ("OSPF", 6), ("链路状态", 6), ("LSI", 5), ("SPF", 5), ("路由协议", 5)],
    "CN5": [("传输层", 5), ("TCP", 4), ("UDP", 4), ("端口", 4), ("拥塞控制", 6), ("流量控制", 5), ("三次握手", 6), ("四次挥手", 6), ("超时重传", 5), ("慢开始", 5), ("拥塞避免", 5), ("快重传", 5), ("快恢复", 5)],
    "CN6": [("应用层", 5), ("DNS", 5), ("HTTP", 5), ("FTP", 5), ("SMTP", 5), ("POP3", 5), ("IMAP", 5), ("电子邮件", 5), ("WWW", 4), ("域名", 4), ("万维网", 4), ("客户/服务器", 4), ("P2P", 4)],
}


def score_chapter(text: str, keywords: list[tuple[str, int]]) -> int:
    score = 0
    for keyword, weight in keywords:
        count = text.count(keyword)
        if count:
            score += min(count, 3) * weight
    return score


SUBJECTS = ["DS", "CO", "OS", "CN"]


def subject_scores(scores: dict[str, int]) -> dict[str, int]:
    return {subject: sum(value for code, value in scores.items() if code.startswith(subject)) for subject in SUBJECTS}


def segment_scores(scores: list[dict[str, int]]) -> list[list[int]]:
    """Best contiguous subject segmentation preserving the real exam order."""
    n = len(scores)
    prefix = {subject: [0] * (n + 1) for subject in SUBJECTS}
    for index, row in enumerate(scores):
        for subject in SUBJECTS:
            prefix[subject][index + 1] = prefix[subject][index] + row[subject]
    negative = -10**9
    dp = [[negative] * (n + 1) for _ in range(len(SUBJECTS) + 1)]
    back = [[0] * (n + 1) for _ in range(len(SUBJECTS) + 1)]
    dp[0][0] = 0
    for k, subject in enumerate(SUBJECTS, start=1):
        for i in range(n + 1):
            for j in range(i + 1):
                value = dp[k - 1][j] + prefix[subject][i] - prefix[subject][j]
                if value > dp[k][i]:
                    dp[k][i] = value
                    back[k][i] = j
    result = [None] * n
    cursor = n
    for k in range(len(SUBJECTS), 0, -1):
        start = back[k][cursor]
        for index in range(start, cursor):
            result[index] = SUBJECTS[k - 1]
        cursor = start
    return result


def main() -> None:
    tree = json.loads((ROOT / "pipeline" / "output" / "cs408-knowledge.json").read_text(encoding="utf-8"))
    by_code = {node["code"]: node for node in tree}
    rows = [json.loads(line) for line in BANK.read_text(encoding="utf-8").splitlines() if line.strip()]
    tags = {}
    low = []
    by_year = defaultdict(Counter)
    by_year_chapter = defaultdict(Counter)
    by_year_rows = defaultdict(list)
    for row in rows:
        question_text = row["question_text"]
        answer_text = row["answer_text"]
        option_text = " ".join(option.get("text") or "" for option in row["options"])
        primary = f"{question_text} {option_text} {option_text}"
        secondary = f"{answer_text} {row.get('explanation') or ''}"
        scores = {code: score_chapter(primary, keywords) * 2 + score_chapter(secondary, keywords) for code, keywords in KEYWORDS.items()}
        by_year_rows[row["year"]].append((row, scores))
    for year, entries in sorted(by_year_rows.items()):
        single = [(row, scores) for row, scores in entries if row["qtype"] == "single_choice"]
        free = [(row, scores) for row, scores in entries if row["qtype"] == "free_response"]
        for group, segmented in ((single, True), (free, False)):
            if not group:
                continue
            subjects = segment_scores([subject_scores(scores) for _, scores in group]) if segmented else [
                max(subject_scores(scores), key=subject_scores(scores).get) for _, scores in group
            ]
            for (row, scores), subject in zip(group, subjects):
                chapters = {code: value for code, value in scores.items() if code.startswith(subject)}
                chapter = max(chapters, key=chapters.get) if chapters else None
                chapter_score = chapters.get(chapter, 0) if chapter else 0
                best_code = max(scores, key=scores.get)
                tags[row["id"]] = {
                    "chapter": chapter,
                    "subject": subject,
                    "score": chapter_score,
                    "subject_score": subject_scores(scores)[subject],
                    "confidence": "high" if chapter_score >= 20 else "medium" if chapter_score >= 8 else "low",
                    "unsegmented_best": best_code,
                }
                by_year[year][subject] += 1
                if chapter:
                    by_year_chapter[year][chapter] += 1
                if chapter_score < 8:
                    low.append((year, row["number"], subject, chapter, chapter_score, row["question_text"][:80]))
    OUT.write_text(json.dumps(tags, ensure_ascii=False, indent=1), encoding="utf-8")
    print("tagged", len(tags), "low", len(low))
    for year in sorted(by_year):
        print(year, "subject", dict(by_year[year]))
        print("  ", "".join(tags[f"cs408-{year}-{n:02d}"]["subject"] for n in range(1, 48)))
    print("low sample")
    for item in low[:20]:
        print(item)
    print("confidence", Counter(value["confidence"] for value in tags.values()))


if __name__ == "__main__":
    main()
