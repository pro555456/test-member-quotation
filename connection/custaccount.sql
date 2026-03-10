-- CREATE TABLE `custaccount` (
--     `id` int(20) NOT NULL AUTO_INCREMENT,
--     `account` varchar(20) NOT NULL,
--     `password` varchar(20) NOT NULL,
--     `type` varchar(1) NOT NULL,
--     `name` varchar(20) NOT NULL,
--     `cellphone` varchar(10) NOT NULL,
--     `email` varchar(200) NOT NULL,
--     `birthday` date NOT NULL,
--     `create_date` date NOT NULL DEFAULT current_timestamp(),
--     `update_date` date NOT NULL DEFAULT current_timestamp(),
--     `remark` varchar(200) NOT NULL,
--     PRIMARY KEY (`id`)
--   )

create table custaccount (
    id int(20) NOT NULL AUTO_INCREMENT,
    account varchar(20) NOT NULL,
    password varchar(20) NOT NULL,
    type varchar(1) NOT NULL,
    name varchar(20) NOT NULL,
    cellphone varchar(10) NOT NULL,
    email varchar(200) NOT NULL,
    birthday date NOT NULL,
    create_date datetime NOT NULL DEFAULT current_timestamp(),
    update_date datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    remark varchar(200) NOT NULL,
    PRIMARY KEY (id)
);
