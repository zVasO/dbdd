-- 300 tables dans une base dédiée (test sidebar / cache structures),
-- + une table large de 120 colonnes (virtualisation colonnes côté MySQL).

CREATE DATABASE zoo;
USE zoo;

DELIMITER $$
CREATE PROCEDURE make_tables()
BEGIN
    DECLARE i INT DEFAULT 1;
    WHILE i <= 300 DO
        SET @ddl = CONCAT(
            'CREATE TABLE t_', LPAD(i, 3, '0'),
            ' (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80), val DECIMAL(8,2), at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
        SET @ins = CONCAT(
            'INSERT INTO t_', LPAD(i, 3, '0'),
            ' (name, val) VALUES (''row 1'', 1.5), (''row 2'', 2.5), (''row 3'', 3.5)');
        PREPARE s FROM @ins; EXECUTE s; DEALLOCATE PREPARE s;
        SET i = i + 1;
    END WHILE;
END$$

CREATE PROCEDURE make_wide()
BEGIN
    DECLARE i INT DEFAULT 1;
    SET @cols = '';
    WHILE i <= 120 DO
        SET @cols = CONCAT(@cols, IF(i = 1, '', ', '), 'col_', i,
            CASE
              WHEN i % 10 = 0 THEN ' VARCHAR(60)'
              WHEN i % 7  = 0 THEN ' DECIMAL(10,2)'
              WHEN i % 5  = 0 THEN ' DATETIME'
              WHEN i % 3  = 0 THEN ' DOUBLE'
              ELSE ' INT'
            END);
        SET i = i + 1;
    END WHILE;
    SET @ddl = CONCAT('CREATE TABLE wide_cols (id BIGINT AUTO_INCREMENT PRIMARY KEY, ', @cols, ')');
    PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

    SET i = 1;
    SET @vals = '';
    WHILE i <= 120 DO
        SET @vals = CONCAT(@vals, IF(i = 1, '', ', '),
            CASE
              WHEN i % 10 = 0 THEN CONCAT('CONCAT(''txt_'', seq.g)')
              WHEN i % 7  = 0 THEN CONCAT('ROUND(seq.g * ', i, ' / 100, 2)')
              WHEN i % 5  = 0 THEN 'NOW() - INTERVAL seq.g MINUTE'
              WHEN i % 3  = 0 THEN CONCAT('seq.g * ', i, ' / 7')
              ELSE CONCAT('(seq.g * ', i, ') % 10000')
            END);
        SET i = i + 1;
    END WHILE;
    SET @cnames = '';
    SET i = 1;
    WHILE i <= 120 DO
        SET @cnames = CONCAT(@cnames, IF(i = 1, '', ', '), 'col_', i);
        SET i = i + 1;
    END WHILE;
    SET @ins = CONCAT(
        'INSERT INTO wide_cols (', @cnames, ') ',
        'WITH RECURSIVE seq(g) AS (SELECT 1 UNION ALL SELECT g + 1 FROM seq WHERE g < 3000) ',
        'SELECT ', @vals, ' FROM seq');
    SET SESSION cte_max_recursion_depth = 3001;
    PREPARE s FROM @ins; EXECUTE s; DEALLOCATE PREPARE s;
END$$
DELIMITER ;

CALL make_tables();
CALL make_wide();
DROP PROCEDURE make_tables;
DROP PROCEDURE make_wide;

GRANT ALL PRIVILEGES ON zoo.* TO 'vasodb'@'%';
FLUSH PRIVILEGES;
